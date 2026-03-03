import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { checkSolana } from "../../../../skills/rugcheck.js";
import { logJobEvent, maskAddress, reasonFromErrors } from "../lib/logger.js";

const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1/tokens";

function isSolanaMint(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

export function validateRequirements(req: any): ValidationResult {
  const mint = String(req?.mintAddress ?? "").trim();
  if (!isSolanaMint(mint))
    return {
      valid: false,
      reason: "mintAddress must be a valid Solana base58 address (32–44 chars)",
    };
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "SuicaTap Solana Risk — RugCheck score + PASS/CAUTION/BLOCK verdict.";
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const mintAddress = String(req.mintAddress).trim();
  const t0 = Date.now();
  logJobEvent({
    phase: "start",
    offering: "suicatap_solana_risk",
    chain: "solana",
    token: maskAddress(mintAddress),
  });

  const receiptUrl = `${RUGCHECK_BASE}/${mintAddress}/report/summary`;

  try {
    const r = await checkSolana(mintAddress);
    const verdict = r.riskLevel <= 10 ? "PASS" : r.riskLevel <= 40 ? "CAUTION" : "BLOCK";
    const emoji = verdict === "PASS" ? "🟢" : verdict === "CAUTION" ? "🟡" : "🔴";

    const deliverable = {
      type: "suicatap_solana_risk_v1",
      value: {
        mintAddress,
        chain: "solana",
        verdict,
        emoji,
        score: r.score,
        riskLevel: r.riskLevel,
        risks: r.risks,
        isGood: r.isGood,
        receiptUrl,
      },
    };

    logJobEvent({
      phase: "ok",
      offering: "suicatap_solana_risk",
      chain: "solana",
      token: maskAddress(mintAddress),
      durationMs: Date.now() - t0,
      outcome: verdict,
    });
    return { deliverable };
  } catch (err: any) {
    logJobEvent({
      phase: "fail",
      offering: "suicatap_solana_risk",
      chain: "solana",
      token: maskAddress(mintAddress),
      durationMs: Date.now() - t0,
      outcome: "TEMP_UNAVAILABLE",
      reasonCode: reasonFromErrors([String(err?.message || err)]),
    });
    return {
      deliverable: {
        type: "suicatap_solana_risk_v1",
        value: {
          mintAddress,
          chain: "solana",
          verdict: "TEMP_UNAVAILABLE",
          serviceStatus: "degraded",
          emoji: "🟡",
          risks: ["rugcheck endpoint temporarily unavailable"],
          receiptUrl,
          error: String(err?.message || err),
        },
      },
    };
  }
}
