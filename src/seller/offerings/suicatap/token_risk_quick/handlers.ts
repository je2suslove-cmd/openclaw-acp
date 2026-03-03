import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { logJobEvent, maskAddress, reasonFromErrors } from "../lib/logger.js";

const DEFAULT_RISK_URL = "https://acp-acp-whoami-production.up.railway.app/r/risk";

const RISK_URL = process.env.SUICATAP_RISK_URL || DEFAULT_RISK_URL;
const TIMEOUT_MS = Number(process.env.SUICATAP_TIMEOUT_MS || "8000");

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

export function validateRequirements(request: any): ValidationResult {
  const tokenAddress = String(request?.tokenAddress || "").trim();
  if (!isEvmAddress(tokenAddress)) {
    return {
      valid: false,
      reason: "Invalid tokenAddress. Expected EVM address like 0xabc... (40 hex chars).",
    };
  }
  return { valid: true };
}

function pick<T>(...vals: T[]): T | undefined {
  return vals.find((v) => v !== undefined && v !== null);
}

function emojiFromVerdict(v: string): string {
  const s = v.toUpperCase();
  if (s.includes("ALLOW") || s.includes("GREEN") || s.includes("SAFE")) return "🟢";
  if (s.includes("BLOCK") || s.includes("RED") || s.includes("DANGER")) return "🔴";
  return "🟡";
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const tokenAddress = String(request.tokenAddress).trim();
  const chain = String(request?.chain || "base").trim();
  const t0 = Date.now();
  logJobEvent({
    phase: "start",
    offering: "token_risk_quick",
    chain,
    token: maskAddress(tokenAddress),
  });

  const receiptUrl = `${RISK_URL}?tokenAddress=${encodeURIComponent(tokenAddress)}`;

  try {
    const data = await fetchJson(receiptUrl);

    const beep: string = data?.risk?.beep ?? "🟡";
    const verdict = beep === "🔴" ? "BLOCK" : beep === "🟢" ? "PASS" : "CAUTION";
    const riskLevel = Number(data?.risk?.riskLevel ?? 50);

    const topFlags: string[] = Array.isArray(data?.risk?.reasons)
      ? data.risk.reasons.slice(0, 5)
      : [];

    const deliverable = {
      type: "suicatap_token_risk_quick_v1",
      value: {
        tokenAddress,
        chain,
        verdict,
        emoji: beep,
        riskLevel,
        topFlags,
        receiptUrl,
        raw: data,
      },
    };

    logJobEvent({
      phase: "ok",
      offering: "token_risk_quick",
      chain,
      token: maskAddress(tokenAddress),
      durationMs: Date.now() - t0,
      outcome: verdict,
    });
    return { deliverable };
  } catch (err: any) {
    // 실패해도 "완료 deliverable"로 반환 → expired/rejected 누적을 줄임 (단, 메시지는 솔직하게)
    logJobEvent({
      phase: "fail",
      offering: "token_risk_quick",
      chain,
      token: maskAddress(tokenAddress),
      durationMs: Date.now() - t0,
      outcome: "TEMP_UNAVAILABLE",
      reasonCode: reasonFromErrors([String(err?.message || err)]),
    });
    return {
      deliverable: {
        type: "suicatap_token_risk_quick_v1",
        value: {
          tokenAddress,
          chain,
          verdict: "TEMP_UNAVAILABLE",
          emoji: "🟡",
          topFlags: ["risk endpoint temporarily unavailable"],
          receiptUrl,
          error: String(err?.message || err),
        },
      },
    };
  }
}
