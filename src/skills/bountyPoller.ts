let bountyTimer: NodeJS.Timeout | null = null;

export function startBountyPoller() {
  if (bountyTimer) return;
  const intervalMs = Number(process.env.BOUNTY_INTERVAL_MS ?? 5 * 60 * 1000);
  console.log(`[Bounty] 자동 응찰 대기 중 (interval=${intervalMs}ms) — acp CLI 없이 동작`);
  // bounty poll은 acp CLI 필요 — Railway 환경에서는 직접 API 호출 필요
  // 현재는 로그만 남기고 향후 구현
  bountyTimer = setInterval(() => {
    console.log("[Bounty] poll tick (구현 예정)");
  }, intervalMs);
  (bountyTimer as any).unref?.();
}
