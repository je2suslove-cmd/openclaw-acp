export interface RugCheckResult {
  mint: string;
  score: number;
  riskLevel: number;
  risks: string[];
  isGood: boolean;
  raw: any;
}

export async function checkSolana(mint: string): Promise<RugCheckResult> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`RugCheck API error ${res.status}`);
  const json: any = await res.json();

  const score = json?.score ?? 50;
  const risks: string[] = (json?.risks ?? []).map((r: any) => r?.name ?? String(r));
  const riskLevel = score >= 800 ? 10 : score >= 500 ? 40 : score >= 200 ? 70 : 95;

  return { mint, score, riskLevel, risks: risks.slice(0, 8), isGood: score >= 500, raw: json };
}

export function formatRugCheck(r: RugCheckResult): string {
  const emoji = r.riskLevel <= 10 ? "🟢" : r.riskLevel <= 40 ? "🟡" : "🔴";
  return [
    `${emoji} Solana RugCheck`,
    `• mint: ${r.mint.slice(0, 10)}...`,
    `• score=${r.score} (높을수록 안전)`,
    `• riskLevel=${r.riskLevel}`,
    `• risks: ${r.risks.length ? r.risks.join(", ") : "(none)"}`,
    `• verdict=${r.isGood ? "PASS" : "CAUTION/BLOCK"}`,
    ``,
    `🍉 SuicaTap | execution_gate $0.30 | report $0.35`,
  ].join("\n");
}
