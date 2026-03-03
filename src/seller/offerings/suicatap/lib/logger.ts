/**
 * suicatap/lib/logger.ts
 * Minimal structured job-event logger — no secrets, no request bodies.
 * tokenAddress is ALWAYS masked before logging.
 */

export type LogPhase = "start" | "ok" | "fail";

export type ReasonCode =
  | "ERR_UPSTREAM_TIMEOUT"
  | "ERR_UPSTREAM_HTTP"
  | "ERR_BAD_INPUT"
  | "ERR_CHAIN_UNSUPPORTED"
  | "ERR_UPSTREAM";

export interface JobEventArgs {
  phase: LogPhase;
  offering: string;
  chain?: string;
  /** Pre-masked token identifier — use maskAddress() before passing. */
  token?: string;
  durationMs?: number;
  outcome?: string;
  reasonCode?: ReasonCode;
}

/** Mask an EVM or Solana address for safe logging. Never logs the full address. */
export function maskAddress(addr: unknown): string {
  if (typeof addr !== "string" || !addr) return "(none)";
  const s = addr.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  if (s.length >= 8) return `sol:${s.slice(0, 4)}…${s.slice(-4)}`;
  return "(masked)";
}

/**
 * Infer a ReasonCode from a collected errors array.
 * Checks for timeout/abort first, then HTTP status, then generic upstream.
 */
export function reasonFromErrors(errors: string[]): ReasonCode {
  for (const e of errors) {
    const l = e.toLowerCase();
    if (l.includes("abort") || l.includes("timeout")) return "ERR_UPSTREAM_TIMEOUT";
    if (/http\s+\d{3}/.test(l)) return "ERR_UPSTREAM_HTTP";
  }
  return "ERR_UPSTREAM";
}

/** Emit a single structured log line. Safe to call from any async context. */
export function logJobEvent(args: JobEventArgs): void {
  const { phase, offering, chain = "base", token, durationMs, outcome, reasonCode } = args;
  const parts: string[] = [
    "[suicatap]",
    `phase=${phase}`,
    `offering=${offering}`,
    `chain=${chain}`,
  ];
  if (token) parts.push(`token=${token}`);
  if (durationMs !== undefined) parts.push(`dur=${durationMs}ms`);
  if (outcome) parts.push(`outcome=${outcome}`);
  if (reasonCode) parts.push(`reason=${reasonCode}`);
  console.log(parts.join(" "));
}
