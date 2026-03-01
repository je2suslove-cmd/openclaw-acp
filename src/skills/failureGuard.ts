let consecutiveFailures = 0;
let totalJobs = 0;
let totalSuccess = 0;
const ALERT_THRESHOLD = 5;

let notifier: ((msg: string) => Promise<any> | any) | null = null;

export function setNotifier(fn: (msg: string) => Promise<any> | any) {
  notifier = fn;
}

export function recordJobResult(success: boolean) {
  totalJobs++;
  if (success) {
    consecutiveFailures = 0;
    totalSuccess++;
  } else {
    consecutiveFailures++;
    if (consecutiveFailures >= ALERT_THRESHOLD) {
      const msg = `🚨 SuicaTap 연속 실패 ${consecutiveFailures}회!\n성공률: ${((totalSuccess / totalJobs) * 100).toFixed(1)}% (${totalSuccess}/${totalJobs})\n즉시 점검 필요`;
      console.error("[Guard]", msg);
      notifier?.(msg).catch(() => {});
    }
  }
}

export function getStats() {
  return {
    consecutiveFailures,
    totalJobs,
    successRate: totalJobs > 0 ? ((totalSuccess / totalJobs) * 100).toFixed(1) + "%" : "N/A",
  };
}
