const RESOURCE_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";

type RiskSummary = {
  token?: { name?: string; symbol?: string; address?: string };
  chain?: { id?: string; name?: string; shortName?: string };
  summary?: { risk?: string; riskLevel?: number; flags?: string[] };
  honeypot?: { isHoneypot?: boolean; honeypotReason?: string };
  taxes?: { buyTax?: number; sellTax?: number; transferTax?: number };
  contract?: { openSource?: boolean; isProxy?: boolean; hasProxyCalls?: boolean };
  raw?: any;
};

export async function checkHoneypot(address: string, _chainId?: string): Promise<RiskSummary> {
  const url = `${RESOURCE_BASE}?tokenAddress=${address.trim()}`;
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });

  // Check Content-Type before parsing to avoid crash on HTML error pages (e.g., 502 gateway)
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Resource API HTTP ${res.status}: non-JSON response (${contentType || "no content-type"})`
    );
  }

  const json: any = await res.json();
  if (!res.ok) {
    const msg = json?.error || `Resource API HTTP ${res.status}`;
    throw new Error(msg);
  }

  const risk = json?.risk ?? {};
  const token = json?.token ?? {};
  const lvl: number = risk.riskLevel ?? 99;

  return {
    token: {
      name: token.symbol,
      symbol: token.symbol,
      address: token.address ?? address,
    },
    chain: { id: "8453", name: "base", shortName: "base" },
    summary: {
      risk: lvl >= 4 ? "CRITICAL" : lvl >= 2 ? "MEDIUM" : "LOW",
      riskLevel: lvl,
      flags: Array.isArray(risk.reasons) ? risk.reasons : [],
    },
    honeypot: {
      isHoneypot: risk.isHoneypot ?? false,
      honeypotReason: risk.isHoneypot ? "Honeypot detected via Resource API" : undefined,
    },
    taxes: {
      buyTax: risk.buyTax ?? 0,
      sellTax: risk.sellTax ?? 0,
      transferTax: 0,
    },
    contract: {
      openSource: false,
      isProxy: false,
      hasProxyCalls: false,
    },
    raw: json,
  };
}

export function formatRisk(r: RiskSummary): string {
  const sym = r.token?.symbol ? `$${r.token.symbol}` : "(unknown)";
  const chain = r.chain?.shortName ?? r.chain?.name ?? "(chain?)";
  const risk = r.summary?.risk ?? "(risk?)";
  const lvl = r.summary?.riskLevel ?? -1;
  const hp = r.honeypot?.isHoneypot;
  const flags = (r.summary?.flags ?? []).slice(0, 8);

  const tax = `tax(buy/sell)=${r.taxes?.buyTax ?? "?"}/${r.taxes?.sellTax ?? "?"}`;

  return [
    `🧪 /risk 결과: ${sym} on ${chain}`,
    `• risk=${risk} (level=${lvl})`,
    `• honeypot=${hp ?? "unknown"}${r.honeypot?.honeypotReason ? ` (${r.honeypot.honeypotReason})` : ""}`,
    `• ${tax}`,
    flags.length ? `• flags: ${flags.join(", ")}` : `• flags: (none)`,
    ``,
    `💡 업셀: token_risk_quick / suicatap_report / suicatap_tx_preflight`,
  ].join("\n");
}
