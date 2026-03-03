import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { hasCredit, consumeCredit } from "../../../lib/reviews.js";
import { logJobEvent, maskAddress, reasonFromErrors } from "../lib/logger.js";

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

export function validateRequirements(req: any): ValidationResult {
  if (!isHexAddress(req?.agentAddress))
    return { valid: false, reason: "agentAddress must be a 0x… 40-byte EVM address" };
  if (!isHexAddress(req?.tokenAddress))
    return { valid: false, reason: "tokenAddress must be a 0x… 40-byte EVM address" };
  if (!hasCredit(String(req.agentAddress)))
    return {
      valid: false,
      reason:
        "No loyalty credit found for this agentAddress. Submit a review via suicatap_review (free) to earn a free scan.",
    };
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "SuicaTap Loyalty Scan — redeeming your free credit.";
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const agentAddress = String(req.agentAddress).trim();
  const tokenAddress = String(req.tokenAddress).trim();
  const t0 = Date.now();

  logJobEvent({
    phase: "start",
    offering: "suicatap_loyalty_scan",
    chain: "base",
    token: maskAddress(tokenAddress),
  });

  const receiptUrl = `${RESOURCE_BASE}?tokenAddress=${tokenAddress}`;
  const ts = new Date().toISOString();
  const errors: string[] = [];
  let raw: any = null;

  // Run the scan FIRST, then consume credit only on success
  try {
    raw = await fetchJson(receiptUrl);
  } catch (e: any) {
    errors.push(`ResourceAPI: ${String(e?.message ?? e)}`);
  }

  // Consume credit after we have a result (even partial) — prevents silent credit loss
  if (!consumeCredit(agentAddress)) {
    return {
      deliverable:
        "❌ Credit already consumed or not found. Submit a new review via suicatap_review to earn another free scan.",
    };
  }

  const risk = raw?.risk ?? {};
  const symbol: string = raw?.token?.symbol ?? "UNKNOWN";
  const beep: string = risk.beep ?? "🟡";
  const reasons: string[] = Array.isArray(risk.reasons) ? risk.reasons : ["No risk data available"];
  const liqUsd = Number(risk.liqUsd ?? 0);
  const vol24 = Number(risk.vol24 ?? 0);
  const riskLevel = Number(risk.riskLevel ?? 99);
  const buyTax = Number(risk.buyTax ?? 0);
  const sellTax = Number(risk.sellTax ?? 0);
  const isHoneypot = Boolean(risk.isHoneypot ?? false);

  if (Array.isArray(raw?.errors)) errors.push(...raw.errors);

  const receipt = {
    version: "suicatap_loyalty_scan_v1",
    timestamp: ts,
    chainID: 8453,
    redeemedBy: agentAddress,
    token: { address: tokenAddress, symbol },
    quick: { beep, reasons, liqUsd, vol24, riskLevel, buyTax, sellTax, honeypot: isHoneypot },
    receiptUrl,
    errors,
  };

  const lines: string[] = [];
  lines.push(`🍉 **SuicaTap Loyalty Scan (Base) — ${symbol}**`);
  lines.push(`- 🎁 Free scan redeemed for: \`${agentAddress.slice(0, 10)}…\``);
  lines.push(`- Token: \`${tokenAddress}\``);
  lines.push(`- Time: ${ts}`);
  lines.push("");
  lines.push(`## Beep verdict: ${beep}`);
  reasons.forEach((r) => lines.push(`- ${r}`));
  lines.push(
    `- Liquidity≈$${liqUsd.toFixed(0)}, Vol(24h)≈$${vol24.toFixed(0)}, Tax=${buyTax}%/${sellTax}%`
  );
  lines.push("");
  lines.push("## Proof (JSON Resource)");
  lines.push(receiptUrl);
  lines.push("");
  lines.push("## Receipt (JSON)");
  lines.push("```json");
  lines.push(JSON.stringify(receipt, null, 2));
  lines.push("```");
  lines.push("> Note: Technical risk summary only. Not financial advice.");
  lines.push(
    "\n\n━━━━━━━━━━━━━━━━━━━━\n🍉 SuicaTap — earn more free scans by submitting another review via suicatap_review!"
  );

  const outcome = beep === "🔴" ? "BLOCK" : beep === "🟡" ? "CAUTION" : "PASS";
  logJobEvent({
    phase: errors.length > 0 ? "fail" : "ok",
    offering: "suicatap_loyalty_scan",
    chain: "base",
    token: maskAddress(tokenAddress),
    durationMs: Date.now() - t0,
    outcome,
    reasonCode: errors.length > 0 ? reasonFromErrors(errors) : undefined,
  });

  return { deliverable: lines.join("\n") };
}
