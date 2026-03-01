import "./seller/runtime/seller.ts";
import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const BASE_CHAIN_ID = 8453;

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
  if (riskLevel >= 3) reasons.push(`riskLevel=${riskLevel}`);
  if (buyTax >= 10 || sellTax >= 10) reasons.push(`tax=${buyTax}%/${sellTax}%`);
  if (liqUsd < 10_000) reasons.push(`liqUsd≈${liqUsd.toFixed(0)}`);

  const beep =
    honeypot || riskLevel >= 4
      ? "🔴"
      : riskLevel >= 2 || buyTax >= 5 || sellTax >= 5 || liqUsd < 50_000
        ? "🟡"
        : "🟢";

  if (reasons.length === 0) reasons.push("no-critical-flags");
  return { beep, reasons: reasons.slice(0, 5) };
}

async function computeRisk(tokenAddress: string) {
  const ts = new Date().toISOString();
  const dexUrl = `https://api.dexscreener.com/token-pairs/v1/base/${tokenAddress}`;
  const honeyUrl = `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${BASE_CHAIN_ID}`;

  const errors: string[] = [];
  let bestPair: any | null = null;
  let honey: any | null = null;

  try {
    const dex = await fetchJson(dexUrl);
    bestPair = pickBestPair(Array.isArray(dex) ? dex : []);
  } catch (e: any) {
    errors.push(`DexScreener: ${String(e?.message ?? e)}`);
  }

  try {
    honey = await fetchJson(honeyUrl);
  } catch (e: any) {
    errors.push(`Honeypot: ${String(e?.message ?? e)}`);
  }

  const tokenSymbol = honey?.token?.symbol ?? bestPair?.baseToken?.symbol ?? "UNKNOWN";
  const liqUsd = Number(bestPair?.liquidity?.usd ?? 0);
  const vol24 = Number(bestPair?.volume?.h24 ?? 0);

  const isHoneypot = Boolean(honey?.honeypotResult?.isHoneypot ?? false);
  const riskLevel = Number(honey?.summary?.riskLevel ?? 99);
  const buyTax = Number(honey?.simulationResult?.buyTax ?? 0);
  const sellTax = Number(honey?.simulationResult?.sellTax ?? 0);

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

// Telegram start point (single entry): only when explicitly enabled.
if (process.env.TELEGRAM_ENABLED === "1") {
  const delayMs = Number(process.env.TELEGRAM_START_DELAY_MS ?? 15000);
  const safeDelayMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 15000;
  console.log(`[Telegram] scheduled start in ${safeDelayMs}ms`);
  const timer = setTimeout(async () => {
    try {
      const mod = await import("./telegramBot.js");
      await mod.startTelegramBot?.();
    } catch (err: any) {
      // Non-fatal by requirement: HTTP/resource server must keep running.
      console.error("[Telegram] start failed (non-fatal):", String(err?.message ?? err));
    }
  }, safeDelayMs);
  (timer as any).unref?.();
} else {
  console.log("[Telegram] disabled (TELEGRAM_ENABLED!=1)");
}
