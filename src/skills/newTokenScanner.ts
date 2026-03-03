import { checkHoneypot, formatRisk } from "./risk.js";

// ── DexScreener 새 토큰 감지 ──
let scanTimer: NodeJS.Timeout | null = null;
const seenTokens = new Set<string>();

async function fetchNewTokens(chainId = "base"): Promise<string[]> {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-profiles/latest/v1`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const items: any[] = Array.isArray(json) ? json : [];
    return items
      .filter((x: any) => (x?.chainId ?? "").toLowerCase() === chainId)
      .map((x: any) => x?.tokenAddress)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function startNewTokenScanner(
  sendMessage: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
) {
  if (scanTimer || !adminChatId) return;
  const intervalMs = Number(process.env.SCANNER_INTERVAL_MS ?? 10 * 60 * 1000); // 10분
  const chainId = process.env.SCANNER_CHAIN ?? "base";

  console.log(`[Scanner] 새 토큰 스캔 시작 (chain=${chainId}, interval=${intervalMs}ms)`);

  scanTimer = setInterval(async () => {
    try {
      const tokens = await fetchNewTokens(chainId);
      const newOnes = tokens.filter((t) => !seenTokens.has(t.toLowerCase()));

      for (const addr of newOnes.slice(0, 5)) {
        // 최대 5개씩
        seenTokens.add(addr.toLowerCase());
        if (seenTokens.size > 500) {
          const first = seenTokens.values().next().value as string;
          seenTokens.delete(first);
        }

        try {
          const r = await checkHoneypot(addr, "8453");
          const lvl = r.summary?.riskLevel ?? -1;
          const isHp = r.honeypot?.isHoneypot ?? false;

          // 🔴 위험 토큰만 알림 (riskLevel >= 80 또는 honeypot)
          if (lvl >= 80 || isHp) {
            await sendMessage(
              adminChatId,
              [`🆕 새 토큰 감지 — 위험!`, formatRisk(r), `📋 주소: \`${addr}\``].join("\n")
            );
          }
        } catch (e: any) {
          console.error(`[Scanner] honeypot check failed for ${addr}:`, e?.message ?? e);
        }

        await new Promise((r) => setTimeout(r, 1500)); // API rate limit
      }
    } catch (e: any) {
      console.error("[Scanner] interval tick failed:", e?.message ?? e);
    }
  }, intervalMs);

  (scanTimer as any).unref?.();
}

export function stopNewTokenScanner() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
