import "./seller/runtime/seller.ts";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import { handleTelegramUpdate } from "./telegramBot.js";

const PORT = Number(process.env.PORT || 8080);
const BASE_CHAIN_ID = 8453;
const TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res: any, status: number, body: any) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("payload_too_large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("invalid_json"), { status: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function pickBestPair(pairs: any[]): any | null {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  return (
    pairs
      .map((p) => {
        const liqUsd = Number(p?.liquidity?.usd ?? 0);
        const vol24 = Number(p?.volume?.h24 ?? 0);
        return { p, score: liqUsd * 10 + vol24 };
      })
      .sort((a, b) => b.score - a.score)[0]?.p ?? null
  );
}

function beepFromSignals(args: {
  honeypot?: boolean;
  riskLevel?: number;
  buyTax?: number;
  sellTax?: number;
  liqUsd?: number;
}) {
  const reasons: string[] = [];
  const honeypot = args.honeypot ?? false;
  const riskLevel = args.riskLevel ?? 99;
  const buyTax = args.buyTax ?? 0;
  const sellTax = args.sellTax ?? 0;
  const liqUsd = args.liqUsd ?? 0;

  if (honeypot) reasons.push("isHoneypot=true");
  if (riskLevel >= 40) reasons.push(`riskLevel=${riskLevel}`);
  if (buyTax >= 10 || sellTax >= 10) reasons.push(`tax=${buyTax}%/${sellTax}%`);
  if (liqUsd < 10_000) reasons.push(`liqUsd≈${liqUsd.toFixed(0)}`);

  const beep =
    honeypot || riskLevel >= 80
      ? "🔴"
      : riskLevel >= 40 || buyTax >= 5 || sellTax >= 5 || liqUsd < 50_000
        ? "🟡"
        : "🟢";

  if (reasons.length === 0) reasons.push("no-critical-flags");
  return { beep, reasons: reasons.slice(0, 5) };
}

async function computeRisk(tokenAddress: string) {
  const ts = new Date().toISOString();
  const dexUrl = `https://api.dexscreener.com/token-pairs/v1/base/${tokenAddress}`;
  const goPlusUrl = `https://api.gopluslabs.io/api/v1/token_security/${BASE_CHAIN_ID}?contract_addresses=${tokenAddress}`;

  const errors: string[] = [];
  let bestPair: any | null = null;
  let gp: any | null = null;

  try {
    const dex = await fetchJson(dexUrl);
    bestPair = pickBestPair(Array.isArray(dex) ? dex : []);
  } catch (e: any) {
    errors.push(`DexScreener: ${String(e?.message ?? e)}`);
  }

  try {
    gp = await fetchJson(goPlusUrl);
  } catch (e: any) {
    errors.push(`GoPlus: ${String(e?.message ?? e)}`);
  }

  const d = gp?.result?.[tokenAddress.toLowerCase()] ?? {};
  const tokenSymbol = d?.token_symbol ?? bestPair?.baseToken?.symbol ?? "UNKNOWN";
  const liqUsd = Number(bestPair?.liquidity?.usd ?? 0);
  const vol24 = Number(bestPair?.volume?.h24 ?? 0);

  const isHoneypot = d?.is_honeypot === "1";
  const buyTax = Math.round(parseFloat(d?.buy_tax ?? "0") * 100);
  const sellTax = Math.round(parseFloat(d?.sell_tax ?? "0") * 100);
  const isMintable = d?.is_mintable === "1";
  const hasHiddenOwner = d?.hidden_owner === "1";
  const cannotSellAll = d?.cannot_sell_all === "1";

  // 0–100 riskLevel (GoPlus 플래그 기반)
  const flagCount = [
    isHoneypot,
    buyTax > 10,
    sellTax > 10,
    isMintable,
    hasHiddenOwner,
    cannotSellAll,
  ].filter(Boolean).length;
  const riskLevel = isHoneypot
    ? 99
    : flagCount >= 4
      ? 85
      : flagCount >= 2
        ? 60
        : flagCount >= 1
          ? 40
          : 10;

  const { beep, reasons } = beepFromSignals({
    honeypot: isHoneypot,
    riskLevel,
    buyTax,
    sellTax,
    liqUsd,
  });

  return {
    version: "suicatap_resource_v1",
    timestamp: ts,
    chain: { name: "base", chainID: BASE_CHAIN_ID },
    token: { address: tokenAddress, symbol: tokenSymbol },
    risk: { beep, reasons, riskLevel, buyTax, sellTax, isHoneypot, liqUsd, vol24 },
    errors,
  };
}

createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? "/", "http://localhost");
    if (u.pathname === "/telegram-webhook" && req.method === "POST") {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
      const receivedSecret = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
      if (!expectedSecret || receivedSecret !== expectedSecret) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }

      let update: any;
      try {
        update = await readJsonBody(req, TELEGRAM_WEBHOOK_MAX_BODY_BYTES);
      } catch (e: any) {
        const status = Number(e?.status ?? 500);
        if (status === 413) {
          res.writeHead(413);
          res.end("payload_too_large");
          return;
        }
        res.writeHead(status >= 400 && status < 500 ? status : 500);
        res.end("bad_request");
        return;
      }

      // Respond immediately; do not block webhook delivery on bot command latency.
      res.writeHead(200);
      res.end("ok");
      void handleTelegramUpdate(update).catch((err: any) => {
        console.error("[Telegram] webhook update handling failed:", String(err?.message ?? err));
      });
      return;
    }

    if (u.pathname === "/health") return sendJson(res, 200, { ok: true });

    if (u.pathname === "/r/risk") {
      const tokenAddress = u.searchParams.get("tokenAddress") ?? "";
      if (!isHexAddress(tokenAddress))
        return sendJson(res, 400, { error: "tokenAddress must be 0x... (40 bytes)" });
      const receipt = await computeRisk(tokenAddress.trim());
      return sendJson(res, 200, receipt);
    }

    return sendJson(res, 404, {
      error: "not_found",
      paths: ["/health", "/r/risk?tokenAddress=0x..."],
    });
  } catch (e: any) {
    return sendJson(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(PORT, () => {
  console.log(`[http] Resource API listening on port ${PORT}`);
});

// Telegram init point (single entry): only when explicitly enabled.
if (process.env.TELEGRAM_ENABLED === "1") {
  const delayMs = Number(process.env.TELEGRAM_START_DELAY_MS ?? 15000);
  const safeDelayMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 15000;
  console.log(`[Telegram] webhook bot init in ${safeDelayMs}ms`);
  const timer = setTimeout(async () => {
    try {
      const mod = await import("./telegramBot.js");
      await mod.startTelegramBot?.();
    } catch (err: any) {
      console.error("[Telegram] init failed (non-fatal):", String(err?.message ?? err));
    }
  }, safeDelayMs);
  (timer as any).unref?.();
} else {
  console.log("[Telegram] disabled (TELEGRAM_ENABLED!=1)");
}

// ── 자동화 스킬 (non-fatal) ──
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null;

setTimeout(async () => {
  if (ADMIN_CHAT_ID) {
    try {
      const { getTelegramBot } = await import("./telegramBot.js");
      const bot = getTelegramBot();
      if (bot) {
        const { startNewTokenScanner } = await import("./skills/newTokenScanner.js");
        startNewTokenScanner(
          (chatId, text) => bot.telegram.sendMessage(chatId, text),
          ADMIN_CHAT_ID
        );
      }
    } catch (e: any) {
      console.error("[Scanner] init failed:", e?.message ?? e);
    }
  } else {
    console.log("[Scanner] ADMIN_CHAT_ID not set; 새 토큰 알림 비활성");
  }
}, 30000); // 30초 후 시작
