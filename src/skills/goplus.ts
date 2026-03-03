export interface GoPlusResult {
  address: string;
  chain: string;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  isOpenSource: boolean;
  isProxy: boolean;
  isMintable: boolean;
  isBlacklisted: boolean;
  riskLevel: number;
  flags: string[];
  raw: any;
}

export async function checkGoPlus(address: string, chainId: string): Promise<GoPlusResult> {
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const json: any = await res.json();
  if (!res.ok || json?.code !== 1)
    throw new Error(json?.message || `GoPlus API error ${res.status}`);

  const d = json?.result?.[address.toLowerCase()] ?? {};
  const buyTax = parseFloat(d?.buy_tax ?? "0") * 100;
  const sellTax = parseFloat(d?.sell_tax ?? "0") * 100;
  const isHoneypot = d?.is_honeypot === "1";
  const isMintable = d?.is_mintable === "1";
  const isBlacklisted = d?.is_blacklisted === "1";

  const flags: string[] = [];
  if (isHoneypot) flags.push("HONEYPOT");
  if (buyTax > 10) flags.push(`BUY_TAX_${buyTax.toFixed(0)}%`);
  if (sellTax > 10) flags.push(`SELL_TAX_${sellTax.toFixed(0)}%`);
  if (isMintable) flags.push("MINTABLE");
  if (isBlacklisted) flags.push("BLACKLIST");
  if (d?.cannot_sell_all === "1") flags.push("CANNOT_SELL_ALL");
  if (d?.trading_cooldown === "1") flags.push("TRADING_COOLDOWN");
  if (d?.transfer_pausable === "1") flags.push("TRANSFER_PAUSABLE");
  if (d?.hidden_owner === "1") flags.push("HIDDEN_OWNER");

  const riskLevel = isHoneypot
    ? 99
    : flags.length >= 4
      ? 85
      : flags.length >= 2
        ? 60
        : flags.length >= 1
          ? 40
          : 10;

  return {
    address,
    chain: chainId,
    isHoneypot,
    buyTax,
    sellTax,
    isOpenSource: d?.is_open_source === "1",
    isProxy: d?.is_proxy === "1",
    isMintable,
    isBlacklisted,
    riskLevel,
    flags,
    raw: d,
  };
}

export function formatGoPlus(r: GoPlusResult): string {
  const emoji = r.isHoneypot ? "🔴" : r.riskLevel >= 60 ? "🟡" : "🟢";
  return [
    `${emoji} GoPlus Security`,
    `• addr: ${r.address.slice(0, 10)}...`,
    `• honeypot=${r.isHoneypot}`,
    `• tax(buy/sell)=${r.buyTax.toFixed(1)}%/${r.sellTax.toFixed(1)}%`,
    `• mintable=${r.isMintable} proxy=${r.isProxy}`,
    `• flags: ${r.flags.length ? r.flags.join(", ") : "(none)"}`,
    `• riskLevel=${r.riskLevel}`,
    ``,
    `🍉 SuicaTap | execution_gate $0.30 | report $0.35`,
  ].join("\n");
}
