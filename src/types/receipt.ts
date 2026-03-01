export interface SafetyReceipt {
  version: "suicatap_v2";
  generated_at: string;
  valid_for_minutes: number;
  decision: "PASS" | "CAUTION" | "BLOCK";
  score: number;
  token: {
    address: string;
    symbol?: string;
    name?: string;
    chain: string;
    chainId: number;
  };
  reasons: string[];
  recommended_action: "BUY" | "WAIT" | "AVOID";
  flags: {
    honeypot: boolean;
    high_tax: boolean;
    low_liquidity: boolean;
    proxy_contract: boolean;
    open_source: boolean;
  };
  metrics: {
    risk_level: number;
    buy_tax: number;
    sell_tax: number;
    liquidity_usd: number;
    volume_24h: number;
  };
  handoff?: {
    recommended_agent?: string;
    payload?: object;
  };
  evidence_links: string[];
}

export function buildReceipt(
  address: string,
  chain: string,
  chainId: number,
  risk: any
): SafetyReceipt {
  const riskLevel = risk?.riskLevel ?? 50;
  const isHoneypot = risk?.isHoneypot ?? false;
  const buyTax = risk?.buyTax ?? 0;
  const sellTax = risk?.sellTax ?? 0;
  const liqUsd = risk?.liqUsd ?? 0;
  const score = Math.max(0, Math.min(100, 100 - riskLevel));

  let decision: "PASS" | "CAUTION" | "BLOCK" = "PASS";
  if (isHoneypot || riskLevel >= 80) decision = "BLOCK";
  else if (riskLevel >= 40 || buyTax > 10 || sellTax > 10 || liqUsd < 10000) decision = "CAUTION";

  const recommended_action =
    decision === "PASS" ? "BUY" : decision === "CAUTION" ? "WAIT" : "AVOID";

  const reasons: string[] = [];
  if (isHoneypot) reasons.push("honeypot detected");
  if (riskLevel >= 80) reasons.push(`riskLevel=${riskLevel} (critical)`);
  else if (riskLevel >= 40) reasons.push(`riskLevel=${riskLevel} (elevated)`);
  if (buyTax > 10) reasons.push(`buyTax=${buyTax}% (high)`);
  if (sellTax > 10) reasons.push(`sellTax=${sellTax}% (high)`);
  if (liqUsd < 10000) reasons.push(`liquidity=$${liqUsd.toFixed(0)} (low)`);
  if (reasons.length === 0) reasons.push("no critical flags");

  return {
    version: "suicatap_v2",
    generated_at: new Date().toISOString(),
    valid_for_minutes: 10,
    decision,
    score,
    token: { address, chain, chainId },
    reasons,
    recommended_action,
    flags: {
      honeypot: isHoneypot,
      high_tax: buyTax > 10 || sellTax > 10,
      low_liquidity: liqUsd < 10000,
      proxy_contract: risk?.isProxy ?? false,
      open_source: risk?.openSource ?? false,
    },
    metrics: {
      risk_level: riskLevel,
      buy_tax: buyTax,
      sell_tax: sellTax,
      liquidity_usd: liqUsd,
      volume_24h: risk?.vol24 ?? 0,
    },
    evidence_links: [
      `https://honeypot.is/ethereum?address=${address}`,
      `https://acp-acp-whoami-production.up.railway.app/r/risk?tokenAddress=${address}`,
    ],
  };
}
