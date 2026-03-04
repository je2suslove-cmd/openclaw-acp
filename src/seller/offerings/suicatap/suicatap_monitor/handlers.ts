import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent, maskAddress } from "../lib/logger.js";

const RESOURCE_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";
const UPSELL = `\n\n🍉 SuicaTap | execution_gate $0.30 | report $0.35`;

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateRequirements(req: any): ValidationResult {
  if (!req?.tokenAddress) return { valid: false, reason: "tokenAddress required" };
  if (!EVM_ADDRESS_RE.test(req.tokenAddress))
    return { valid: false, reason: "tokenAddress must be a 0x-prefixed 42-character hex address" };
  return { valid: true };
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const { tokenAddress, chain = "base" } = req;
  const t0 = Date.now();
  logJobEvent({
    phase: "start",
    offering: "suicatap_monitor",
    chain,
    token: maskAddress(tokenAddress),
  });

  try {
    const url = `${RESOURCE_BASE}?tokenAddress=${tokenAddress}&chain=${chain}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Resource API error ${res.status}`);
    const raw: any = await res.json();

    const risk = raw?.risk ?? {};
    const isHoneypot = risk?.isHoneypot ?? false;
    const riskLevel = risk?.riskLevel ?? 50;
    const buyTax = risk?.buyTax ?? 0;
    const sellTax = risk?.sellTax ?? 0;
    const liq = raw?.risk?.liqUsd ?? 0;

    const verdict = isHoneypot ? "🔴 BLOCK" : riskLevel >= 60 ? "🟡 CAUTION" : "🟢 PASS";
    const alerts: string[] = [];
    if (isHoneypot) alerts.push("HONEYPOT DETECTED");
    if (buyTax > 10) alerts.push(`HIGH BUY TAX: ${buyTax}%`);
    if (sellTax > 10) alerts.push(`HIGH SELL TAX: ${sellTax}%`);
    if (liq < 10000 && liq > 0) alerts.push(`LOW LIQUIDITY: $${liq.toFixed(0)}`);

    const result = {
      verdict,
      tokenAddress,
      chain,
      symbol: raw?.token?.symbol ?? "?",
      riskLevel,
      isHoneypot,
      buyTax,
      sellTax,
      liquidity_usd: liq,
      alerts,
      snapshot_at: new Date().toISOString(),
      message: alerts.length
        ? `⚠️ ${alerts.length} alert(s): ${alerts.join(", ")}`
        : "✅ No alerts — token appears safe",
    };

    const outcomeKey = verdict.includes("BLOCK")
      ? "BLOCK"
      : verdict.includes("CAUTION")
        ? "CAUTION"
        : "PASS";
    logJobEvent({
      phase: "ok",
      offering: "suicatap_monitor",
      chain,
      token: maskAddress(tokenAddress),
      durationMs: Date.now() - t0,
      outcome: outcomeKey,
    });
    return { deliverable: JSON.stringify(result, null, 2) + UPSELL };
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    const rc =
      errMsg.toLowerCase().includes("abort") || errMsg.toLowerCase().includes("timeout")
        ? ("ERR_UPSTREAM_TIMEOUT" as const)
        : errMsg.toLowerCase().includes("http")
          ? ("ERR_UPSTREAM_HTTP" as const)
          : ("ERR_UPSTREAM" as const);
    logJobEvent({
      phase: "fail",
      offering: "suicatap_monitor",
      chain,
      token: maskAddress(tokenAddress),
      durationMs: Date.now() - t0,
      outcome: "UNKNOWN",
      reasonCode: rc,
    });
    return {
      deliverable: JSON.stringify(
        {
          verdict: "🟡 UNKNOWN",
          tokenAddress,
          chain,
          error: errMsg,
          snapshot_at: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }
}
