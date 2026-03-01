import "dotenv/config";
import { Telegraf, type Context } from "telegraf";
import type { Update } from "telegraf/types";
import { geminiGenerate } from "./llm/gemini.js";
import { checkHoneypot, formatRisk } from "./skills/risk.js";
import { watchAdd, watchRemove, watchList, startWatchLoop } from "./skills/watch.js";
import { makeReceipt } from "./skills/receipt.js";

let botSingleton: Telegraf<Context> | null = null;
let handlersRegistered = false;

// ── 헬퍼 ──
function clip(text: string, max = 3500) {
  const t = (text ?? "").toString();
  return t.length > max ? t.slice(0, max - 20) + "\n...(truncated)" : t;
}

function getMsgText(ctx: any): string {
  return ctx?.message?.text ?? "";
}

function argsAfter(text: string, cmd: string): string {
  return text.replace(new RegExp("^\\/" + cmd + "(?:@\\w+)?\\s*"), "").trim();
}

// ── 인메모리 컨텍스트 ──
interface Turn {
  role: "user" | "assistant";
  text: string;
}
interface ChatState {
  turns: Turn[];
  summary: string;
}
const chatStore = new Map<number, ChatState>();

function getState(chatId: number): ChatState {
  if (!chatStore.has(chatId)) chatStore.set(chatId, { turns: [], summary: "" });
  return chatStore.get(chatId)!;
}
function appendTurn(chatId: number, role: "user" | "assistant", text: string) {
  const st = getState(chatId);
  st.turns.push({ role, text });
  if (st.turns.length > 20) st.turns = st.turns.slice(-15);
}
function getChatStatus(chatId: number): object {
  const st = getState(chatId);
  return { chatId, turns: st.turns.length, summaryLen: st.summary.length };
}

const SYSTEM = [
  "You are SuicaTap, a crypto risk assistant.",
  "Be concise, practical, and safety-first.",
  "If user asks for trading advice, give risk factors and safer alternatives.",
].join(" ");

function registerHandlers(bot: Telegraf<Context>) {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // /start
  bot.start((ctx) =>
    ctx.reply("안녕하세요! SuicaTap 🍉\n/do /risk /receipt /watch /ctx /q /me 사용 가능")
  );

  // /me
  bot.command("me", async (ctx) => {
    await ctx.reply(`chatId=${ctx.chat.id}\nuserId=${ctx.from?.id ?? "?"}`);
  });

  // /do <텍스트>
  bot.command("do", async (ctx: any) => {
    const text = getMsgText(ctx);
    const userText = argsAfter(text, "do");
    const chatId = ctx?.chat?.id;
    if (!userText) return ctx.reply("사용법: /do <텍스트>");
    if (!process.env.GEMINI_API_KEY?.trim()) return ctx.reply("설정 필요: GEMINI_API_KEY");
    try {
      appendTurn(chatId, "user", userText);
      await ctx.reply("처리 중...");
      const out = await geminiGenerate(userText, {
        systemInstruction: SYSTEM,
        timeoutMs: 25000,
        retries: 2,
        maxInputChars: 8000,
      });
      const safe = clip(out || "(empty)");
      appendTurn(chatId, "assistant", safe);
      await ctx.reply(safe);
    } catch (e: any) {
      await ctx.reply(`오류: ${String(e?.message || e)}`);
    }
  });

  // /risk <addr> [chainId]
  bot.command("risk", async (ctx: any) => {
    const rest = argsAfter(getMsgText(ctx), "risk");
    const [address, chainId] = rest.split(/\s+/).filter(Boolean);
    if (!address) return ctx.reply("사용법: /risk <tokenAddress> [chainId]");
    try {
      await ctx.reply("스캔 중...");
      const r = await checkHoneypot(address, chainId);
      await ctx.reply(clip(formatRisk(r)));
    } catch (e: any) {
      await ctx.reply(`오류: /risk 실패 — ${String(e?.message || e)}`);
    }
  });

  // /receipt <addr> [chainId]
  bot.command("receipt", async (ctx: any) => {
    const rest = argsAfter(getMsgText(ctx), "receipt");
    const [address, chainId] = rest.split(/\s+/).filter(Boolean);
    if (!address) return ctx.reply("사용법: /receipt <tokenAddress> [chainId]");
    try {
      const json = await makeReceipt(address, chainId);
      await ctx.reply(clip("```json\n" + json + "\n```"));
    } catch (e: any) {
      await ctx.reply(`오류: receipt 실패 — ${String(e?.message || e)}`);
    }
  });

  // /watch add|del|list
  bot.command("watch", async (ctx: any) => {
    const rest = argsAfter(getMsgText(ctx), "watch");
    const [sub, a1, a2] = rest.split(/\s+/).filter(Boolean);
    const chatId = ctx?.chat?.id;
    const s = (sub || "list").toLowerCase();
    if (s === "list") {
      const items = watchList(chatId);
      return ctx.reply(
        items.length ? "📌 watchlist:\n- " + items.join("\n- ") : "watchlist 비어있음"
      );
    }
    if (s === "add") {
      if (!a1) return ctx.reply("사용법: /watch add <tokenAddress> [chainId]");
      const k = watchAdd(chatId, a1, a2);
      return ctx.reply("✅ watch 등록: " + k);
    }
    if (s === "del" || s === "remove") {
      if (!a1) return ctx.reply("사용법: /watch del <tokenAddress>");
      const ok = watchRemove(a1, a2);
      return ctx.reply(ok ? "🗑️ watch 제거" : "해당 watch 없음");
    }
    return ctx.reply("사용법: /watch add|del|list");
  });

  // /ctx
  bot.command("ctx", async (ctx: any) => {
    const st = getChatStatus(ctx?.chat?.id);
    await ctx.reply(clip(JSON.stringify(st, null, 2)));
  });

  // /q
  bot.command("q", async (ctx) => {
    await ctx.reply("queue: 기능 준비 중");
  });

  // watch loop
  startWatchLoop(async (chatId: any, text: string) => bot.telegram.sendMessage(chatId, clip(text)));

  // fallback
  bot.on("text", (ctx) => {
    ctx.reply("명령어: /do /risk /receipt /watch /ctx /q /me");
  });
}

export function getTelegramBot(): Telegraf<Context> | null {
  if (botSingleton) return botSingleton;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  botSingleton = new Telegraf<Context>(token);
  registerHandlers(botSingleton);
  return botSingleton;
}

export async function startTelegramBot() {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN missing; webhook disabled");
    return;
  }
  console.log("[Telegram] webhook bot initialized");
}

export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const bot = getTelegramBot();
  if (!bot) return;
  await bot.handleUpdate(update as Update);
}
