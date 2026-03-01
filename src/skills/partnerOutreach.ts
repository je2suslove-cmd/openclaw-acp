let outreachTimer: NodeJS.Timeout | null = null;

export function startPartnerOutreach() {
  if (outreachTimer) return;
  const intervalMs = Number(process.env.OUTREACH_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  console.log(`[Outreach] 파트너 자동 발주 시작 (interval=${intervalMs / 3600000}h)`);
  outreachTimer = setInterval(() => {
    console.log("[Outreach] tick");
  }, intervalMs);
  (outreachTimer as any).unref?.();
}
