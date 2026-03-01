import cron from "node-cron";
import PQueue from "p-queue";
import type { Telegraf } from "telegraf";
import crypto from "node:crypto";

type RunAgent = (prompt: string, meta: { userId: string }) => Promise<string>;

export interface TaskOps {
  enqueueTask: (params: {
    chatId: number;
    userId: string;
    prompt: string;
    label?: string;
  }) => Promise<string>;
  startNightlyScheduler: () => void;
  getQueueStats: () => { size: number; pending: number };
}

export function startTaskOps(opts: { bot: Telegraf; runAgent: RunAgent }): TaskOps {
  const { bot, runAgent } = opts;

  const queue = new PQueue({
    concurrency: Number(process.env.TASK_CONCURRENCY ?? "1"),
  });

  let nightlyRunning = false;

  async function enqueueTask(params: {
    chatId: number;
    userId: string;
    prompt: string;
    label?: string;
  }) {
    const taskId = crypto.randomUUID();
    const label = params.label ?? "user";

    await bot.telegram.sendMessage(
      params.chatId,
      `✅ 작업 접수 #${taskId}\n- type: ${label}\n- 큐 대기 중`
    );

    queue.add(async () => {
      await bot.telegram.sendMessage(params.chatId, `🚀 작업 시작 #${taskId}`);
      try {
        const out = await runAgent(params.prompt, { userId: params.userId });
        const safe = out.length > 3500 ? out.slice(0, 3500) + "\n…(truncated)" : out;
        await bot.telegram.sendMessage(params.chatId, `🏁 완료 #${taskId}\n\n${safe}`);
      } catch {
        await bot.telegram.sendMessage(
          params.chatId,
          `❌ 실패 #${taskId}\n(잠시 후 다시 시도해줘)`
        );
      }
    });

    return taskId;
  }

  function startNightlyScheduler() {
    if (process.env.NIGHTLY_ENABLED === "false") return;

    const cronExpr = process.env.NIGHTLY_CRON ?? "0 3 * * *";
    const timezone = process.env.NIGHTLY_TZ ?? "Asia/Seoul";
    const adminChatIdRaw = process.env.ADMIN_CHAT_ID;

    if (!adminChatIdRaw) {
      console.log("[nightly] ADMIN_CHAT_ID not set; nightly scheduler disabled");
      return;
    }
    const adminChatId = Number(adminChatIdRaw);

    cron.schedule(
      cronExpr,
      async () => {
        if (nightlyRunning) return;
        nightlyRunning = true;
        try {
          await bot.telegram.sendMessage(adminChatId, "🌙 Nightly 시작: 작업 큐에 넣는 중…");

          const nightlyPrompts: string[] = [
            "오늘 ACP 판매 데이터/실패 원인 요약하고 개선 액션 3개 제안해줘.",
            "오늘 유입 키워드/오퍼링 문구 A/B 테스트 아이디어 5개 만들어줘.",
          ];

          for (const p of nightlyPrompts) {
            await enqueueTask({
              chatId: adminChatId,
              userId: "admin",
              prompt: p,
              label: "nightly",
            });
          }

          await bot.telegram.sendMessage(adminChatId, "✅ Nightly 큐 등록 완료");
        } finally {
          nightlyRunning = false;
        }
      },
      { timezone }
    );

    console.log(`[nightly] scheduled ${cronExpr} (${timezone})`);
  }

  return {
    enqueueTask,
    startNightlyScheduler,
    getQueueStats: () => ({ size: queue.size, pending: queue.pending }),
  };
}
