import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent, reasonFromErrors } from "../lib/logger.js";
import { isHexAddress, withSla, scanRiskApi } from "../lib/utils.js";

const BASE_CHAIN_ID = 8453;

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

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  // 1. Input validation — return, not throw
  if (!Array.isArray(req?.tokenAddresses) || req.tokenAddresses.length === 0) {
    return { deliverable: "Invalid request: tokenAddresses must be a non-empty array" };
  }

  // 2. SLA 4-min timeout wrapper
  return withSla(
    (async (): Promise<ExecuteJobResult> => {
      const tokenAddresses: string[] = req.tokenAddresses;
      const t0 = Date.now();
      logJobEvent({ phase: "start", offering: "suicatap_batch", chain: "base" });
      const ts = new Date().toISOString();

      const results = await Promise.all(tokenAddresses.map((a) => scanRiskApi(a)));

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
        const receiptUrl = `https://acp-acp-whoami-production.up.railway.app/r/risk?tokenAddress=${addr}`;

        lines.push(`### [${i + 1}] ${beep} ${symbol}`);
        lines.push(`- Address: \`${addr}\``);
        lines.push(`- Verdict: ${beep} — ${reasons}`);
        lines.push(`- Liquidity: ${liq} | Tax: ${tax}`);
        lines.push(`- Receipt: ${receiptUrl}`);
        lines.push("");
      });

      lines.push("> Note: Technical risk summary only. Not financial advice.");
      lines.push("");
      lines.push("## Receipt (JSON)");
      lines.push("```json");
      lines.push(
        JSON.stringify(
          {
            version: "suicatap_batch_v1",
            timestamp: ts,
            chainID: BASE_CHAIN_ID,
            tokens: results.map((r, i) => ({
              address: tokenAddresses[i],
              symbol: r?.token?.symbol ?? "UNKNOWN",
              beep: r?.risk?.beep ?? "⚪",
              reasons: r?.risk?.reasons ?? [],
              liqUsd: r?.risk?.liqUsd ?? null,
              buyTax: r?.risk?.buyTax ?? null,
              sellTax: r?.risk?.sellTax ?? null,
              isHoneypot: r?.risk?.isHoneypot ?? false,
              errors: r?.errors ?? [],
            })),
          },
          null,
          2
        )
      );
      lines.push("```");

      const hasAnyError = results.some((r) => Array.isArray(r?.errors) && r.errors.length > 0);
      const hasRed = results.some((r) => r?.risk?.beep === "🔴");
      const hasYellow = results.some((r) => r?.risk?.beep === "🟡");
      const outcome = hasRed ? "BLOCK" : hasYellow ? "CAUTION" : "PASS";
      const allErrors = results.flatMap((r) => r?.errors ?? []);
      logJobEvent({
        phase: hasAnyError ? "fail" : "ok",
        offering: "suicatap_batch",
        chain: "base",
        durationMs: Date.now() - t0,
        outcome,
        reasonCode: hasAnyError ? reasonFromErrors(allErrors) : undefined,
      });

      return { deliverable: lines.join("\n") };
    })()
  );
}
