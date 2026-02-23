import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const RISK_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";

function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

export function validateRequirements(req: any): ValidationResult {
  const addrs = req?.tokenAddresses;
  if (!Array.isArray(addrs) || addrs.length === 0)
    return { valid: false, reason: "tokenAddresses must be a non-empty array" };
  if (addrs.length > 10) return { valid: false, reason: "Max 10 tokens per wallet sweep" };
  for (const a of addrs) {
    if (!isHexAddress(a)) return { valid: false, reason: `Invalid address: ${a}` };
  }
  return { valid: true };
}

export function requestPayment(_req: any): string {
  return "SuicaTap Wallet Sweep — scanning wallet portfolio risk.";
}

async function scanOne(tokenAddress: string, chain: string): Promise<any> {
  const url = `${RISK_BASE}?tokenAddress=${tokenAddress}&chain=${chain}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e: any) {
    return {
      token: { address: tokenAddress, symbol: "UNKNOWN" },
      risk: { beep: "⚪", reasons: [`scan_error: ${e?.message ?? e}`] },
      errors: [String(e?.message ?? e)],
    };
  }
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const tokenAddresses: string[] = req.tokenAddresses;
  const chain: string = req.chain ?? "base";
  const walletLabel: string = req.walletLabel ?? "Unknown Wallet";
  const ts = new Date().toISOString();

  const results = await Promise.all(tokenAddresses.map((a) => scanOne(a, chain)));

  // 포트폴리오 요약
  const redCount = results.filter((r) => r?.risk?.beep === "🔴").length;
  const yellowCount = results.filter((r) => r?.risk?.beep === "🟡").length;
  const greenCount = results.filter((r) => r?.risk?.beep === "🟢").length;

  const overallRisk =
    redCount > 0 ? "🔴 HIGH RISK" : yellowCount > 0 ? "🟡 MEDIUM RISK" : "🟢 LOW RISK";

  const lines: string[] = [];
  lines.push(`🍉 **SuicaTap Wallet Sweep — ${walletLabel}**`);
  lines.push(`- Chain: ${chain.toUpperCase()}`);
  lines.push(`- Time: ${ts}`);
  lines.push(`- Tokens scanned: ${tokenAddresses.length}`);
  lines.push("");
  lines.push(`## Portfolio Summary: ${overallRisk}`);
  lines.push(`- 🟢 Safe: ${greenCount} | 🟡 Caution: ${yellowCount} | 🔴 Danger: ${redCount}`);
  lines.push("");
  lines.push("## Token Results");

  results.forEach((r, i) => {
    const addr = tokenAddresses[i];
    const symbol = r?.token?.symbol ?? "UNKNOWN";
    const beep = r?.risk?.beep ?? "⚪";
    const reasons = (r?.risk?.reasons ?? []).join(", ");
    const liq = r?.risk?.liqUsd != null ? `$${Number(r.risk.liqUsd).toFixed(0)}` : "?";
    const tax = r?.risk?.buyTax != null ? `${r.risk.buyTax}%/${r.risk.sellTax}%` : "?";
    const honey = r?.risk?.isHoneypot ? "⚠️ HONEYPOT" : "OK";
    const receipt = `${RISK_BASE}?tokenAddress=${addr}&chain=${chain}`;

    lines.push(`### [${i + 1}] ${beep} ${symbol}`);
    lines.push(`- Address: \`${addr}\``);
    lines.push(`- Risk: ${reasons}`);
    lines.push(`- Honeypot: ${honey} | Liquidity: ${liq} | Tax: ${tax}`);
    lines.push(`- Receipt: ${receipt}`);
    lines.push("");
  });

  if (redCount > 0) {
    lines.push("## ⚠️ Action Required");
    lines.push("The following tokens are HIGH RISK — consider removing from portfolio:");
    results.forEach((r, i) => {
      if (r?.risk?.beep === "🔴") {
        lines.push(`- ${r?.token?.symbol ?? tokenAddresses[i]} (\`${tokenAddresses[i]}\`)`);
      }
    });
    lines.push("");
  }

  lines.push("> Note: Technical risk summary only. Not financial advice.");

  return { deliverable: lines.join("\n") };
}
