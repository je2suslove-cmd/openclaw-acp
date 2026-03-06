/**
 * suicatap/lib/utils.ts
 * Shared utilities for all suicatap offering handlers.
 */
import type { ExecuteJobResult } from "../../../runtime/offeringTypes.js";

/** Validate a 0x-prefixed 40-byte EVM hex address. */
export function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

/** Wrap a job promise with a 4-minute SLA deadline. */
export function withSla(work: Promise<ExecuteJobResult>): Promise<ExecuteJobResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ExecuteJobResult>((resolve) => {
    timer = setTimeout(() => resolve({ deliverable: "Processing timeout, please retry" }), 240_000);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Fetch JSON from a URL with AbortController timeout. Throws on non-2xx. */
export async function fetchJson(url: string, timeoutMs = 12_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Map riskLevel + honeypot flag to a beep emoji. */
export function beepFromRisk(riskLevel: number, isHoneypot: boolean): string {
  if (isHoneypot || riskLevel >= 80) return "🔴";
  if (riskLevel >= 40) return "🟡";
  return "🟢";
}
