type Role = "user" | "assistant";

type Turn = { role: Role; text: string; ts: number };

type ChatState = {
  summary: string; // 압축 요약
  turns: Turn[]; // 최근 대화 (요약 이후)
  updatedAt: number;
};

const STATE_PATH = process.env.CHAT_STATE_PATH || "/tmp/suicatap_chat_state.json";
const TRIGGER_CHARS = Number(process.env.COMPACT_TRIGGER_CHARS ?? 12000);
const KEEP_LAST_TURNS = Number(process.env.COMPACT_KEEP_LAST_TURNS ?? 8);
const TARGET_SUMMARY_CHARS = Number(process.env.COMPACT_TARGET_CHARS ?? 1500);
const MAX_TURN_CHARS = Number(process.env.COMPACT_MAX_TURN_CHARS ?? 1500);
const MAX_TURNS = Number(process.env.COMPACT_MAX_TURNS ?? 40);

const states = new Map<string, ChatState>();
let saveTimer: NodeJS.Timeout | null = null;

function clip(s: string, n: number) {
  const t = (s ?? "").toString().replace(/\u0000/g, "");
  return t.length > n ? t.slice(0, n - 12) + "\n...(clipped)" : t;
}

function safeLoad() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    if (!fs.existsSync(STATE_PATH)) return;
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (!v || typeof v !== "object") continue;
        const cs = v as any;
        states.set(String(k), {
          summary: typeof cs.summary === "string" ? cs.summary : "",
          turns: Array.isArray(cs.turns) ? cs.turns : [],
          updatedAt: Number(cs.updatedAt ?? Date.now()),
        });
      }
    }
  } catch {}
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs");
      const out: any = {};
      for (const [k, v] of states.entries()) out[k] = v;
      fs.writeFileSync(STATE_PATH, JSON.stringify(out), "utf8");
    } catch {}
  }, 1500);
}

safeLoad();

function getState(chatId: number | string): ChatState {
  const key = String(chatId);
  const cur = states.get(key);
  if (cur) return cur;
  const init: ChatState = { summary: "", turns: [], updatedAt: Date.now() };
  states.set(key, init);
  return init;
}

export function appendTurn(chatId: number | string, role: Role, text: string) {
  const st = getState(chatId);
  st.turns.push({ role, text: clip(text, MAX_TURN_CHARS), ts: Date.now() });
  st.updatedAt = Date.now();
  if (st.turns.length > MAX_TURNS) st.turns = st.turns.slice(-MAX_TURNS);
  states.set(String(chatId), st);
  scheduleSave();
}

export function approxChars(chatId: number | string): number {
  const st = getState(chatId);
  const turnsText = st.turns.map((t) => `${t.role}: ${t.text}`).join("\n");
  return st.summary.length + turnsText.length;
}

export function renderContext(chatId: number | string): string {
  const st = getState(chatId);
  const recent = st.turns
    .map((t) => (t.role === "user" ? `U: ${t.text}` : `A: ${t.text}`))
    .join("\n");
  return [st.summary ? `[SUMMARY]\n${st.summary}\n` : "", recent ? `[RECENT]\n${recent}\n` : ""]
    .join("\n")
    .trim();
}

export async function compactIfNeeded(
  chatId: number | string,
  summarize: (input: string, targetChars: number) => Promise<string>
): Promise<{ compacted: boolean; summary: string }> {
  const st = getState(chatId);
  const total = approxChars(chatId);
  if (total < TRIGGER_CHARS || st.turns.length <= KEEP_LAST_TURNS) {
    return { compacted: false, summary: st.summary };
  }

  const keep = st.turns.slice(-KEEP_LAST_TURNS);
  const compactPart = st.turns.slice(0, Math.max(0, st.turns.length - KEEP_LAST_TURNS));

  const input = [
    "You are a context compactor.",
    "Summarize the conversation for future turns.",
    "Keep: decisions, constraints, user preferences, open tasks, important facts.",
    `Output Korean. <= ${TARGET_SUMMARY_CHARS} chars. Bullet points preferred.`,
    "",
    st.summary ? `Previous summary:\n${st.summary}\n` : "",
    "Conversation to compact:",
    compactPart.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join("\n"),
  ].join("\n");

  const newSummary = clip(await summarize(input, TARGET_SUMMARY_CHARS), TARGET_SUMMARY_CHARS);

  st.summary = newSummary;
  st.turns = keep;
  st.updatedAt = Date.now();
  states.set(String(chatId), st);
  scheduleSave();

  return { compacted: true, summary: st.summary };
}

export function getChatStatus(chatId: number | string) {
  const st = getState(chatId);
  return {
    summaryChars: st.summary.length,
    turns: st.turns.length,
    approxChars: approxChars(chatId),
    updatedAt: st.updatedAt,
    statePath: STATE_PATH,
  };
}

export function resetChat(chatId: number | string) {
  states.delete(String(chatId));
  scheduleSave();
}
