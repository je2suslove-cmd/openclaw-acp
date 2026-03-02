import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { checkHoneypot } from "../../../../skills/risk.js";

const UPSELL = `\n\n🍉 SuicaTap | execution_gate $0.30 | report $0.35`;

export function validateRequirements(req: any): ValidationResult {
  if (!req?.tokenAddress) return { valid: false, reason: "tokenAddress required" };
  return { valid: true };
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const { tokenAddress, chain = "base" } = req;
  const chainIdMap: Record<string, string> = { base: "8453", ethereum: "1", eth: "1", bsc: "56" };
  const chainId = chainIdMap[chain] ?? "8453";

  try {
    const raw = await checkHoneypot(tokenAddress, chainId);
    const risk = raw.summary?.riskLevel ?? 50;
    const isHoneypot = raw.honeypot?.isHoneypot ?? false;
    const buyTax = raw.taxes?.buyTax ?? 0;
    const sellTax = raw.taxes?.sellTax ?? 0;
    const liq = (raw as any)?.pairs?.[0]?.liquidity?.usd ?? (raw as any)?.pair?.liquidity?.usd ?? 0;

    const verdict = isHoneypot ? "🔴 BLOCK" : risk >= 60 ? "🟡 CAUTION" : "🟢 PASS";
    const alerts: string[] = [];
    if (isHoneypot) alerts.push("HONEYPOT DETECTED");
    if (buyTax > 10) alerts.push(`HIGH BUY TAX: ${buyTax}%`);
    if (sellTax > 10) alerts.push(`HIGH SELL TAX: ${sellTax}%`);
    if (liq < 10000) alerts.push(`LOW LIQUIDITY: $${liq.toFixed(0)}`);

    const result = {
      verdict,
      tokenAddress,
      chain,
      riskLevel: risk,
      isHoneypot,
      buyTax,
      sellTax,
      liquidity_usd: liq,
      alerts,
      snapshot_at: new Date().toISOString(),
      alert_on: "risk_increase OR honeypot OR liquidity_drop",
      message: alerts.length
        ? `⚠️ ${alerts.length} alert(s) detected: ${alerts.join(", ")}`
        : "✅ No alerts — token appears safe at this snapshot",
    };

    return {
      deliverable: JSON.stringify(result, null, 2) + UPSELL,
    };
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
