let outreachTimer: NodeJS.Timeout | null = null;

export function startPartnerOutreach() {
  if (outreachTimer) return;
  const intervalMs = Number(process.env.OUTREACH_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
  console.log(`[Outreach] 파트너 발주 대기 중 (interval=${intervalMs / 3600000}h) — 향후 구현`);
  outreachTimer = setInterval(() => {
    console.log("[Outreach] outreach tick (구현 예정)");
  }, intervalMs);
  (outreachTimer as any).unref?.();
}
