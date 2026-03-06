import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { checkHoneypot } from "../../../../skills/risk.js";
import { buildReceipt } from "../../../../types/receipt.js";
import { logJobEvent, maskAddress } from "../lib/logger.js";
import { isHexAddress, withSla } from "../lib/utils.js";

export function validateRequirements(req: any): ValidationResult {
  if (!isHexAddress(req?.tokenAddress))
    return { valid: false, reason: "tokenAddress must be a 0x… 40-byte address" };
  const chain = req?.chain;
  if (chain && !["base", "ethereum", "eth", "bsc"].includes(chain))
    return { valid: false, reason: "chain must be base|ethereum|eth|bsc" };
  return { valid: true };
}

const CHAIN_MAP: Record<string, { name: string; chainId: number }> = {
  base: { name: "base", chainId: 8453 },
  ethereum: { name: "ethereum", chainId: 1 },
  eth: { name: "ethereum", chainId: 1 },
  bsc: { name: "bsc", chainId: 56 },
};

const EXECUTORS: Record<string, { name: string; wallet: string; job: string }> = {
  base: { name: "ethy_ai", wallet: "0xfc9f1fF5eC524759c1Dc8E0a6EBA6c22805b9d8B", job: "swap" },
  ethereum: {
    name: "safebase",
    wallet: "0x73658eEB3045916Ff4B5277bBAE3bf1be5616588",
    job: "safe_swap",
  },
  bsc: { name: "safebase", wallet: "0x73658eEB3045916Ff4B5277bBAE3bf1be5616588", job: "safe_swap" },
};

export async function executeJob(requirements: any): Promise<ExecuteJobResult> {
  // 1. Input validation — return, not throw
  if (!isHexAddress(requirements?.tokenAddress)) {
    return {
      deliverable: JSON.stringify(
        { decision: "INVALID_INPUT", error: "tokenAddress must be a 0x… 40-byte address" },
        null,
        2
      ),
    };
  }

  // 2. SLA 4-min timeout wrapper
  return withSla(
    (async (): Promise<ExecuteJobResult> => {
      const { tokenAddress, chain = "base", amount, fromToken } = requirements;
      const t0 = Date.now();
      logJobEvent({
        phase: "start",
        offering: "suicatap_execution_gate",
        chain,
        token: maskAddress(tokenAddress),
      });

      try {
        const chainInfo = CHAIN_MAP[chain] ?? CHAIN_MAP.base;

        const raw = await checkHoneypot(tokenAddress, String(chainInfo.chainId));
        const risk = {
          riskLevel: raw.summary?.riskLevel ?? 50,
          isHoneypot: raw.honeypot?.isHoneypot ?? false,
          buyTax: raw.taxes?.buyTax ?? 0,
          sellTax: raw.taxes?.sellTax ?? 0,
          liqUsd: 0,
          vol24: 0,
          isProxy: raw.contract?.isProxy ?? false,
          openSource: raw.contract?.openSource ?? false,
        };

        const receipt = buildReceipt(tokenAddress, chainInfo.name, chainInfo.chainId, risk);

        const output: any = {
          decision: receipt.decision,
          score: receipt.score,
          receipt,
        };

        if (receipt.decision === "PASS") {
          const executor = EXECUTORS[chain] ?? EXECUTORS.base;
          output.execution_handoff = {
            recommended_executor: executor.name,
            executor_wallet: executor.wallet,
            job_name: executor.job,
            requirements: {
              ...(fromToken ? { fromSymbol: fromToken } : {}),
              toSymbol: tokenAddress,
              ...(amount ? { amount } : {}),
            },
            estimated_cost_usdc: 0.5,
            reason: `SuicaTap score=${receipt.score} — safe to execute`,
          };
        }

        logJobEvent({
          phase: "ok",
          offering: "suicatap_execution_gate",
          chain,
          token: maskAddress(tokenAddress),
          durationMs: Date.now() - t0,
          outcome: receipt.decision,
        });
        return { deliverable: JSON.stringify(output, null, 2) };
      } catch (e: any) {
        // 3. API failure fallback — never throw, return partial result
        const errMsg = String(e?.message ?? e);
        const rc =
          errMsg.toLowerCase().includes("abort") || errMsg.toLowerCase().includes("timeout")
            ? ("ERR_UPSTREAM_TIMEOUT" as const)
            : ("ERR_UPSTREAM" as const);
        logJobEvent({
          phase: "fail",
          offering: "suicatap_execution_gate",
          chain,
          token: maskAddress(tokenAddress),
          durationMs: Date.now() - t0,
          reasonCode: rc,
        });
        return {
          deliverable: JSON.stringify(
            {
              decision: "BLOCK",
              score: 0,
              error: "API temporarily unavailable, partial result",
              snapshot_at: new Date().toISOString(),
            },
            null,
            2
          ),
        };
      }
    })()
  );
}
