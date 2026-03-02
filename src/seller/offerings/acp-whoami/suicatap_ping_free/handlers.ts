import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

export function validateRequirements(_: any): ValidationResult {
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "Free ping";
}

export async function executeJob(_: any): Promise<ExecuteJobResult> {
  return {
    deliverable:
      "OK — SuicaTap is live. Use suicatap_beep ($0.05) for honeypot check, execution_gate ($0.20) for safe swap routing.",
  };
}
