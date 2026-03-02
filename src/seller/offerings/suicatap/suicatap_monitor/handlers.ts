import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const RESOURCE_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";
const UPSELL = `\n\n🍉 SuicaTap | execution_gate $0.30 | report $0.35`;

export function validateRequirements(req: any): ValidationResult {
  if (!req?.tokenAddress) return { valid: false, reason: "tokenAddress required" };
  return { valid: true };
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const { tokenAddress, chain = "base" } = req;

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

    return { deliverable: JSON.stringify(result, null, 2) + UPSELL };
  } catch (e: any) {
    return {
      deliverable: JSON.stringify(
        {
          verdict: "🟡 UNKNOWN",
          tokenAddress,
          chain,
          error: e?.message ?? String(e),
          snapshot_at: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }
}
