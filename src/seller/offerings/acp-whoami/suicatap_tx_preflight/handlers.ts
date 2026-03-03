import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent, maskAddress, reasonFromErrors } from "../../suicatap/lib/logger.js";

type Intent = "approve" | "buy" | "sell";
type Req = {
  tokenAddress: string;
  intent?: Intent;
  amountUsd?: number;
  approveSpender?: string;
  approveUnlimited?: boolean;
};

const BASE_CHAIN_ID = 8453;
const RESOURCE_URL = "https://acp-acp-whoami-production.up.railway.app/r/risk";

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

function classify(beep: string) {
  if (beep === "🔴") return "BLOCK";
  if (beep === "🟡") return "CAUTION";
  return "ALLOW";
}

function recommendSlippage(intent: Intent, liqUsd: number) {
  if (intent === "sell") return "1%–3% (start with a small test size)";
  if (liqUsd >= 500_000) return "0.5%–1% (healthy liquidity)";
  if (liqUsd >= 50_000) return "1%–3% (start conservative)";
  return "3%–8% (low liquidity: strongly recommend a small test trade)";
}

function sizeRule(amountUsd?: number) {
  if (typeof amountUsd !== "number" || !isFinite(amountUsd) || amountUsd <= 0)
    return { tier: "UNKNOWN", tip: "Amount not provided: start with a small test size" };
  if (amountUsd <= 20) return { tier: "SMALL", tip: "Small: lower risk, still verify execution" };
  if (amountUsd <= 200) return { tier: "MEDIUM", tip: "Medium: consider splitting into 2–3 parts" };
  return { tier: "LARGE", tip: "Large: small test first + split entry strongly recommended" };
}

export function validateRequirements(request: any): ValidationResult {
  const token = request?.tokenAddress;
  if (!isHexAddress(token))
    return { valid: false, reason: "tokenAddress must be a 0x… 40-byte address" };
  const intent = request?.intent;
  if (intent && !["approve", "buy", "sell"].includes(intent))
    return { valid: false, reason: "intent must be approve|buy|sell" };
  const spender = request?.approveSpender;
  if (spender && !isHexAddress(spender))
    return { valid: false, reason: "approveSpender must be a 0x… address" };
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "TX Preflight: safety gate before approve/swap (ALLOW/CAUTION/BLOCK) + slippage/sizing guidance + proof link.";
}

export async function executeJob(request: Req): Promise<ExecuteJobResult> {
  const tokenAddress = request.tokenAddress.trim();
  const t0 = Date.now();
  logJobEvent({
    phase: "start",
    offering: "suicatap_tx_preflight",
    chain: "base",
    token: maskAddress(tokenAddress),
  });
  const intent: Intent = (request.intent ?? "buy") as Intent;
  const amountUsd = request.amountUsd;
  const approveUnlimited = Boolean(request.approveUnlimited ?? false);
  const approveSpender = request.approveSpender?.trim() ?? null;

  const ts = new Date().toISOString();
  const receiptUrl = `${RESOURCE_URL}?tokenAddress=${tokenAddress}`;

  const errors: string[] = [];
  let riskRaw: any = null;

  try {
    riskRaw = await fetchJson(receiptUrl);
  } catch (e: any) {
    errors.push(`ResourceAPI: ${String(e?.message ?? e)}`);
  }

  const risk = riskRaw?.risk ?? {};
  const symbol: string = riskRaw?.token?.symbol ?? "UNKNOWN";
  const liqUsd = Number(risk.liqUsd ?? 0);
  const vol24 = Number(risk.vol24 ?? 0);
  const isHoneypot = Boolean(risk.isHoneypot ?? false);
  const riskLevel = Number(risk.riskLevel ?? 99);
  const buyTax = Number(risk.buyTax ?? 0);
  const sellTax = Number(risk.sellTax ?? 0);
  const beep: string =
    risk.beep ?? (isHoneypot || riskLevel >= 4 ? "🔴" : riskLevel >= 2 ? "🟡" : "🟢");

  if (Array.isArray(riskRaw?.errors)) errors.push(...riskRaw.errors);

  const reasons: string[] = Array.isArray(risk.reasons) ? risk.reasons : [];
  if (isHoneypot && !reasons.some((r) => r.includes("Honeypot")))
    reasons.push("Honeypot suspected (isHoneypot=true)");
  if (reasons.length === 0) reasons.push("No critical flags detected (not a guarantee of safety).");

  let decision = classify(beep);
  const warnings: string[] = [];

  if (intent === "approve") {
    if (approveUnlimited) warnings.push("Unlimited approve is risky. Prefer minimal allowance.");
    if (!approveSpender)
      warnings.push("approveSpender not provided. Verify what contract you are approving.");
    if (decision === "ALLOW") decision = "CAUTION";
  }

  const size = sizeRule(amountUsd);
  if (size.tier === "LARGE" && decision === "ALLOW") decision = "CAUTION";
  if (size.tier === "LARGE" && beep === "🟡") decision = "BLOCK";

  const slip = recommendSlippage(intent, liqUsd);

  const preflight = {
    version: "suicatap_preflight_v2",
    timestamp: ts,
    chainID: BASE_CHAIN_ID,
    token: { address: tokenAddress, symbol },
    input: { intent, amountUsd: amountUsd ?? null, approveSpender, approveUnlimited },
    signals: { beep, reasons, riskLevel, buyTax, sellTax, isHoneypot, liqUsd, vol24 },
    decision,
    recommendations: {
      slippage: slip,
      sizing: size,
      actions: [
        "Start with a small test size ($5–$20), then scale",
        "Split entries for low liquidity / elevated tax",
        "Avoid unlimited approve; approve minimal allowance",
      ],
    },
    receiptUrl,
    errors,
  };

  const out: string[] = [];
  out.push(`🍉 **SuicaTap TX Preflight (Base) — ${symbol}**`);
  out.push(`- Token: \`${tokenAddress}\``);
  out.push(`- Intent: **${intent}**`);
  if (typeof amountUsd === "number") out.push(`- Amount (USD): ~${amountUsd}`);
  out.push(`- Time: ${ts}`);
  out.push("");
  out.push(`## Result: **${decision}** (beep: ${beep})`);
  reasons.forEach((r) => out.push(`- ${r}`));
  warnings.forEach((w) => out.push(`- ⚠️ ${w}`));
  out.push("");
  out.push("## Suggested settings");
  out.push(`- Slippage: ${slip}`);
  out.push(`- Sizing: ${size.tip}`);
  out.push(
    `- Market: Liquidity≈$${liqUsd.toFixed(0)}, Vol(24h)≈$${vol24.toFixed(0)}, Tax=${buyTax}%/${sellTax}%`
  );
  out.push("");
  out.push("## Proof (JSON Resource)");
  out.push(receiptUrl);
  out.push("");
  out.push("## Preflight receipt (JSON)");
  out.push("```json");
  out.push(JSON.stringify(preflight, null, 2));
  out.push("```");
  out.push("> Note: This is a technical risk summary, not financial advice.");

  logJobEvent({
    phase: errors.length > 0 ? "fail" : "ok",
    offering: "suicatap_tx_preflight",
    chain: "base",
    token: maskAddress(tokenAddress),
    durationMs: Date.now() - t0,
    outcome: decision,
    reasonCode: errors.length > 0 ? reasonFromErrors(errors) : undefined,
  });

  return { deliverable: out.join("\n") };
}
