import { checkHoneypot } from "../../../src/skills/risk.js";
import { buildReceipt } from "../../../src/types/receipt.js";

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

export async function executeJob(requirements: any) {
  const { tokenAddress, chain = "base", amount, fromToken } = requirements;
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

  let execution_handoff = null;
  if (receipt.decision === "PASS") {
    const executor = EXECUTORS[chain] ?? EXECUTORS.base;
    execution_handoff = {
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

  return {
    deliverable: {
      decision: receipt.decision,
      score: receipt.score,
      receipt,
      ...(execution_handoff ? { execution_handoff } : {}),
    },
    payableDetail: null,
  };
}
