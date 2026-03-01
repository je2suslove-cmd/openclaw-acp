import "dotenv/config";
import axios from "axios";
import { Telegraf } from "telegraf";
import { geminiGenerate } from "./llm/gemini.js";

let __TG_STARTED__ = false;

function clip(text: string, max = 3500) {
  const t = (text ?? "").toString();
  return t.length > max ? t.slice(0, max - 20) + "\n...(truncated)" : t;
}

function parseArgs(text: string) {
  return text.trim().split(/\s+/).slice(1);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function launchWithRetry(bot: Telegraf) {
  let attempt = 0;

  // webhook이 남아있으면 polling이 충돌할 수 있어서 먼저 삭제
  await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});

  while (true) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log("[Telegram] bot launched");
      return;
    } catch (err: any) {
      const code = err?.error_code;
      const msg = err?.description || err?.message || String(err);

      // 409(getUpdates 충돌)은 기다렸다 재시도
      if (code === 409 || msg.includes("getUpdates") || msg.includes("Conflict")) {
        attempt += 1;
        const delay = Math.min(120000, 5000 * Math.pow(2, attempt - 1));
        console.log(`[Telegram] 409 conflict; retry in ${delay}ms (attempt ${attempt})`);
        await sleep(delay);
        continue;
      }

      console.error("[Telegram] launch failed:", msg);
      throw err;
    }
  }
}

export async function startTelegramBot() {
  if (__TG_STARTED__) {
    console.log("[Telegram] already started; skip");
    return;
  }
  __TG_STARTED__ = true;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN missing; skip");
    return;
  }

  const bot = new Telegraf(token);

  // commands
  bot.command("me", async (ctx) => {
    await ctx.reply(`chatId=${ctx.chat.id}\nuserId=${ctx.from?.id ?? "?"}`);
  });

  bot.command("q", async (ctx) => {
    await ctx.reply("queue disabled; /do runs Gemini directly");
  });

  // /risk <tokenAddress> [chain]
  bot.command("risk", async (ctx) => {
    const [tokenAddress, chain = "base"] = parseArgs(ctx.message?.text ?? "");
    if (!tokenAddress) return ctx.reply("사용법: /risk <tokenAddress> [chain=base|ethereum|bsc]");

    const port = process.env.PORT ?? "8080";
    const base = process.env.SELF_BASE_URL ?? `http://127.0.0.1:${port}`;

    try {
      const { data } = await axios.get(`${base}/r/risk`, {
        params: { tokenAddress, chain },
        timeout: 15000,
      });
      const out = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      await ctx.reply(clip(out));
    } catch {
      await ctx.reply("리스크 조회 실패. 잠시 후 다시 시도해줘.");
    }
  });

  // /do <text> -> Gemini direct
  bot.command("do", async (ctx) => {
    const text = (ctx.message?.text ?? "").replace(/^\/do(\s+)?/, "").trim();
    if (!text) return ctx.reply("사용법: /do <텍스트>");

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      await ctx.reply("설정 필요: GEMINI_API_KEY");
      return;
    }

    const system = [
      "You are SuicaTap, a crypto risk assistant.",
      "Be concise, practical, and safety-first.",
      "If user asks for trading advice, give risk factors and safer alternatives; avoid overconfident predictions.",
    ].join(" ");

    try {
      const out = await geminiGenerate(text, {
        systemInstruction: system,
        timeoutMs: 25000,
        retries: 2,
      });
      await ctx.reply(clip(out));
    } catch (e: any) {
      await ctx.reply(`LLM error: ${String(e?.message || e)}`);
    }
  });

  // fallback
  bot.on("text", (ctx) => {
    ctx.reply("명령어: /do /risk /q /me");
  });

  try {
    await launchWithRetry(bot);
  } catch (e: any) {
    console.error("[Telegram] fatal start error:", String(e?.message || e));
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
