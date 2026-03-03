import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent } from "../lib/logger.js";

export function validateRequirements(_: any): ValidationResult {
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "Free ping";
}

export async function executeJob(_: any): Promise<ExecuteJobResult> {
  const t0 = Date.now();
  logJobEvent({ phase: "start", offering: "suicatap_ping_free" });
  const deliverable =
    "OK — SuicaTap is live. Use suicatap_beep ($0.05) for honeypot check, execution_gate ($0.20) for safe swap routing.";
  logJobEvent({
    phase: "ok",
    offering: "suicatap_ping_free",
    durationMs: Date.now() - t0,
    outcome: "OK",
  });
  return { deliverable };
}
