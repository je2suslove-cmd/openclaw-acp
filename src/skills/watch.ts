import { checkHoneypot } from "./risk.js";

type WatchKey = string;
type WatchEntry = {
  chatId: number | string;
  address: string;
  chainId?: string;
  lastRiskLevel?: number;
  lastFlagsHash?: string;
  lastIsHoneypot?: boolean;
};

const watches = new Map<WatchKey, WatchEntry>();
let timer: NodeJS.Timeout | null = null;

function keyOf(address: string, chainId?: string): WatchKey {
  return `${(chainId || "auto").trim()}:${address.toLowerCase().trim()}`;
}

function hashFlags(flags: any): string {
  try {
    return JSON.stringify(flags ?? []);
  } catch {
    return String(flags ?? "");
  }
}

export function watchAdd(chatId: number | string, address: string, chainId?: string): string {
  const k = keyOf(address, chainId);
  watches.set(k, { chatId, address, chainId });
  return k;
}
export function watchRemove(address: string, chainId?: string): boolean {
  return watches.delete(keyOf(address, chainId));
}
export function watchList(chatId: number | string): string[] {
  const out: string[] = [];
  for (const [k, v] of watches.entries()) if (String(v.chatId) === String(chatId)) out.push(k);
  return out;
}

export function startWatchLoop(
  sendMessage: (chatId: number | string, text: string) => Promise<any> | any
) {
  if (timer) return;
  const intervalMs = Number(process.env.WATCH_INTERVAL_MS ?? 15 * 60 * 1000);

  timer = setInterval(async () => {
    for (const [k, w] of watches.entries()) {
      try {
        const r = await checkHoneypot(w.address, w.chainId);
        const lvl = r.summary?.riskLevel ?? -1;
        const flagsHash = hashFlags(r.summary?.flags);
        const isHp = r.honeypot?.isHoneypot ?? false;

        const changed =
          (w.lastRiskLevel !== undefined && lvl > w.lastRiskLevel) ||
          (w.lastFlagsHash !== undefined && flagsHash !== w.lastFlagsHash) ||
          (w.lastIsHoneypot !== undefined && isHp && w.lastIsHoneypot !== isHp);

        w.lastRiskLevel = lvl;
        w.lastFlagsHash = flagsHash;
        w.lastIsHoneypot = isHp;
        watches.set(k, w);

        if (changed) {
          await sendMessage(
            w.chatId,
            [
              `🚨 /watch 알림: ${k}`,
              `• riskLevel=${lvl}`,
              `• honeypot=${isHp}`,
              `• flags=${(r.summary?.flags ?? []).slice(0, 8).join(", ") || "(none)"}`,
              ``,
              `💡 업셀: suicatap_report / suicatap_tx_preflight`,
            ].join("\n")
          );
        }
      } catch (e: any) {
        console.error(`[Watch] checkHoneypot failed for ${k}:`, e?.message ?? e);
      }
    }
  }, intervalMs);
}
