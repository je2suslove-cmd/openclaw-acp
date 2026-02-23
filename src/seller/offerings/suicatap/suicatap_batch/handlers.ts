import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const BASE_CHAIN_ID = 8453;
const RISK_BASE = "https://acp-acp-whoami-production.up.railway.app/r/risk";

function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

export function validateRequirements(req: any): ValidationResult {
  const addrs = req?.tokenAddresses;
  if (!Array.isArray(addrs) || addrs.length === 0)
    return { valid: false, reason: "tokenAddresses must be a non-empty array" };
  if (addrs.length > 5) return { valid: false, reason: "Max 5 tokens per batch" };
  for (const a of addrs) {
    if (!isHexAddress(a)) return { valid: false, reason: `Invalid address: ${a}` };
  }
  return { valid: true };
}

export function requestPayment(_req: any): string {
  return "SuicaTap Batch Scan — scanning up to 5 tokens. Verifiable JSON receipts included.";
}

async function scanOne(tokenAddress: string): Promise<any> {
  const url = `${RISK_BASE}?tokenAddress=${tokenAddress}`;
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
  const ts = new Date().toISOString();

  const results = await Promise.all(tokenAddresses.map(scanOne));

  const lines: string[] = [];
  lines.push(`🍉 **SuicaTap Batch Scan — ${tokenAddresses.length} token(s)**`);
  lines.push(`- Time: ${ts}`);
  lines.push(`- Chain: Base (chainID ${BASE_CHAIN_ID})`);
  lines.push("");

  results.forEach((r, i) => {
    const addr = tokenAddresses[i];
    const symbol = r?.token?.symbol ?? "UNKNOWN";
    const beep = r?.risk?.beep ?? "⚪";
    const reasons = (r?.risk?.reasons ?? []).join(", ");
    const liq = r?.risk?.liqUsd != null ? `$${Number(r.risk.liqUsd).toFixed(0)}` : "?";
    const tax = r?.risk?.buyTax != null ? `${r.risk.buyTax}%/${r.risk.sellTax}%` : "?";
    const receiptUrl = `${RISK_BASE}?tokenAddress=${addr}`;

    lines.push(`### [${i + 1}] ${beep} ${symbol}`);
    lines.push(`- Address: \`${addr}\``);
    lines.push(`- Verdict: ${beep} — ${reasons}`);
    lines.push(`- Liquidity: ${liq} | Tax: ${tax}`);
    lines.push(`- Receipt: ${receiptUrl}`);
    lines.push("");
  });

  lines.push("> Note: Technical risk summary only. Not financial advice.");

  return { deliverable: lines.join("\n") };
}
