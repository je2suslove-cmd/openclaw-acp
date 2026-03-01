import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

export function validateRequirements(_: any): ValidationResult {
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "Free ping";
}

export async function executeJob(_: any): Promise<ExecuteJobResult> {
  return { deliverable: "OK" };
}
