import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent, maskAddress, reasonFromErrors } from "../lib/logger.js";

type Req = { tokenAddress: string };
const BASE_CHAIN_ID = 8453;
const RESOURCE_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";

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

function daysSince(ms?: number | null): number | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = (Date.now() - Number(ms)) / (1000 * 60 * 60 * 24);
  return d >= 0 ? d : null;
}

function verdictFromSignals(args: {
  isHoneypot: boolean;
  riskLevel: number;
  buyTax: number;
  sellTax: number;
  liqUsd: number;
}) {
  const reasons: string[] = [];
  const { isHoneypot, riskLevel, buyTax, sellTax, liqUsd } = args;

  if (isHoneypot) reasons.push("Honeypot suspected (isHoneypot=true)");
  if (riskLevel >= 3) reasons.push(`High riskLevel=${riskLevel}`);
  if (buyTax >= 10 || sellTax >= 10) reasons.push(`High tax buy/sell=${buyTax}%/${sellTax}%`);
  if (liqUsd < 10_000) reasons.push(`Low liquidity ~ $${liqUsd.toFixed(0)}`);

  const beep: "🟢" | "🟡" | "🔴" =
    isHoneypot || riskLevel >= 4
      ? "🔴"
      : riskLevel >= 2 || buyTax >= 5 || sellTax >= 5 || liqUsd < 50_000
        ? "🟡"
        : "🟢";

  const decision: "ALLOW" | "CAUTION" | "BLOCK" =
    beep === "🔴" ? "BLOCK" : beep === "🟡" ? "CAUTION" : "ALLOW";

  if (reasons.length === 0) reasons.push("No critical flags detected (not a guarantee of safety).");
  return { beep, decision, reasons: reasons.slice(0, 5) };
}

function slipHint(liqUsd: number) {
  if (liqUsd >= 500_000) return "0.5%–1%";
  if (liqUsd >= 50_000) return "1%–3%";
  return "3%–8% (low liquidity: strongly recommend a small test trade)";
}

function mark(ok: boolean, warn?: boolean) {
  if (ok) return "✅";
  if (warn) return "⚠️";
  return "❌";
}

export function validateRequirements(request: any): ValidationResult {
  const token = request?.tokenAddress;
  if (!isHexAddress(token))
    return { valid: false, reason: "tokenAddress must be a 0x… 40-byte address" };
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "SuicaTap Report: 3-line verdict + red flags + checklist + action plan + proof link.";
}

export async function executeJob(request: Req): Promise<ExecuteJobResult> {
  const tokenAddress = request.tokenAddress.trim();
  const t0 = Date.now();
  logJobEvent({
    phase: "start",
    offering: "suicatap_report",
    chain: "base",
    token: maskAddress(tokenAddress),
  });
  const ts = new Date().toISOString();

  // DexScreener: 시장 데이터 (priceUsd, pair 정보)
  const dexUrl = `https://api.dexscreener.com/token-pairs/v1/base/${tokenAddress}`;
  // Resource API: 리스크 데이터 (honeypot.is 직접 호출 대신)
  const riskUrl = `${RESOURCE_BASE}?tokenAddress=${tokenAddress}`;

  const errors: string[] = [];
  let bestPair: any | null = null;
  let riskRaw: any | null = null;

  try {
    bestPair = pickBestPair(await fetchJson(dexUrl));
  } catch (e: any) {
    errors.push(`DexScreener: ${String(e?.message ?? e)}`);
  }
  try {
    riskRaw = await fetchJson(riskUrl);
  } catch (e: any) {
    errors.push(`ResourceAPI: ${String(e?.message ?? e)}`);
  }

  const risk = riskRaw?.risk ?? {};
  const symbol = riskRaw?.token?.symbol ?? bestPair?.baseToken?.symbol ?? "UNKNOWN";

  const priceUsd = bestPair?.priceUsd ?? null;
  const liqUsd = Number(bestPair?.liquidity?.usd ?? risk.liqUsd ?? 0);
  const vol24 = Number(bestPair?.volume?.h24 ?? risk.vol24 ?? 0);
  const dexId = bestPair?.dexId ?? null;
  const pairAddress = bestPair?.pairAddress ?? null;
  const pairUrl = bestPair?.url ?? null;
  const pairCreatedAt = bestPair?.pairCreatedAt ?? null;
  const ageDays = daysSince(typeof pairCreatedAt === "number" ? pairCreatedAt : null);

  const isHoneypot = Boolean(risk.isHoneypot ?? false);
  const riskLevel = Number(risk.riskLevel ?? 99);
  const buyTax = Number(risk.buyTax ?? 0);
  const sellTax = Number(risk.sellTax ?? 0);

  if (Array.isArray(riskRaw?.errors)) errors.push(...riskRaw.errors);

  const { beep, decision, reasons } = verdictFromSignals({
    isHoneypot,
    riskLevel,
    buyTax,
    sellTax,
    liqUsd,
  });
  const slip = slipHint(liqUsd);

  const checklist = [
    { label: "Honeypot", ok: !isHoneypot, warn: false, detail: String(isHoneypot) },
    { label: "RiskLevel", ok: riskLevel <= 1, warn: riskLevel === 2, detail: `level=${riskLevel}` },
    {
      label: "Tax",
      ok: buyTax <= 2 && sellTax <= 2,
      warn: buyTax < 10 && sellTax < 10,
      detail: `${buyTax}%/${sellTax}%`,
    },
    {
      label: "Liquidity",
      ok: liqUsd >= 100_000,
      warn: liqUsd >= 50_000,
      detail: `~$${liqUsd.toFixed(0)}`,
    },
    {
      label: "Pair age",
      ok: (ageDays ?? 0) >= 7,
      warn: (ageDays ?? 0) >= 1,
      detail: ageDays == null ? "unknown" : `${ageDays.toFixed(1)}d`,
    },
  ];

  const action =
    decision === "ALLOW"
      ? [
          "Start with a small test size ($5–$20), then scale",
          `Use conservative slippage: ${slip}`,
          "Avoid unlimited approve; approve minimal allowance",
        ]
      : decision === "CAUTION"
        ? [
            "Small test first, then split entries",
            `Use conservative slippage: ${slip} and verify execution & tax`,
            "Re-check spender/approval details (no unlimited approve)",
          ]
        : [
            "Not recommended to execute (BLOCK)",
            "Protect capital first (honeypot/high tax/low liquidity suspected)",
            "If you must test, use very small size (not recommended)",
          ];

  const proofUrl = `${RESOURCE_BASE}?tokenAddress=${tokenAddress}`;

  const receipt = {
    version: "suicatap_report_v3_en",
    timestamp: ts,
    chainID: BASE_CHAIN_ID,
    token: { address: tokenAddress, symbol },
    verdict: { decision, beep, reasons },
    market: {
      priceUsd,
      liquidityUsd: liqUsd,
      volume24h: vol24,
      dexId,
      pairAddress,
      pairUrl,
      pairCreatedAt,
      ageDays,
    },
    contract: { riskLevel, isHoneypot, buyTax, sellTax },
    checklist,
    recommendations: { slippage: slip, action },
    proofUrl,
    errors,
  };

  const out: string[] = [];
  out.push(`🍉 **SuicaTap Report (Base) — ${symbol}**`);
  out.push(`- Token: \`${tokenAddress}\``);
  out.push(`- Time: ${ts}`);
  out.push("");

  out.push("## 3-line verdict");
  out.push(`- Verdict: **${decision}** (beep: ${beep})`);
  out.push(`- Top reasons: ${reasons.slice(0, 3).join(" / ")}`);
  out.push(`- Next action: ${action[0]}`);
  out.push("");

  out.push("## Red flags (Top)");
  reasons.forEach((r) => out.push(`- ${r}`));
  out.push("");

  out.push("## Checklist (✅/⚠️/❌)");
  checklist.forEach((c) => out.push(`- ${mark(c.ok, c.warn)} ${c.label}: ${c.detail}`));
  out.push("");

  out.push("## Market snapshot");
  out.push(`- Price(USD): ${priceUsd ?? "?"}`);
  out.push(`- Liquidity≈$${liqUsd.toFixed(0)} | Vol(24h)≈$${vol24.toFixed(0)}`);
  out.push(`- DEX: ${dexId ?? "?"} | Pair: ${pairAddress ?? "?"}`);
  if (pairUrl) out.push(`- Pair URL: ${pairUrl}`);
  out.push("");

  out.push("## Action plan");
  action.forEach((a) => out.push(`- ${a}`));
  out.push("");

  out.push("## Proof (JSON Resource)");
  out.push(proofUrl);
  out.push("");

  if (errors.length) {
    out.push("## Errors (if any)");
    errors.forEach((e) => out.push(`- ${e}`));
    out.push("");
  }

  out.push("## Receipt (JSON)");
  out.push("```json");
  out.push(JSON.stringify(receipt, null, 2));
  out.push("```");
  out.push("> Note: This is a technical risk summary, not financial advice.");

  logJobEvent({
    phase: errors.length > 0 ? "fail" : "ok",
    offering: "suicatap_report",
    chain: "base",
    token: maskAddress(tokenAddress),
    durationMs: Date.now() - t0,
    outcome: decision,
    reasonCode: errors.length > 0 ? reasonFromErrors(errors) : undefined,
  });

  return { deliverable: out.join("\n") };
}
