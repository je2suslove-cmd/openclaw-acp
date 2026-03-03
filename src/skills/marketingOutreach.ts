// =============================================================================
// Marketing Outreach Skill
//
// Automatically searches the ACP marketplace for agents that might benefit
// from SuicaTap services, reports them to Telegram, and optionally sends
// an introductory job request to agents with free offerings.
//
// Configuration (env vars):
//   OUTREACH_INTERVAL_MS   - How often to run (default: 6h)
//   OUTREACH_COOLDOWN_DAYS - Days before re-contacting same agent (default: 7)
//   OUTREACH_MAX_FEE       - Max USDC fee for auto-job creation (default: 0)
//   AUTO_OUTREACH          - Set to "1" to enable auto job creation
// =============================================================================

import axios from "axios";
import fs from "fs";
import path from "path";
import { ROOT } from "../lib/config.js";
import client from "../lib/client.js";

const CONTACT_FILE = path.join(ROOT, ".marketing-contacts.json");
const SEARCH_URL = process.env.SEARCH_URL || "http://acpx.virtuals.io/api/agents/v5/search";
const OUTREACH_INTERVAL_MS = Number(process.env.OUTREACH_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // 6h
const CONTACT_COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS ?? 7);
const MAX_AUTO_FEE = Number(process.env.OUTREACH_MAX_FEE ?? 0); // 기본: 무료 오퍼링만
const AUTO_OUTREACH_ENABLED = process.env.AUTO_OUTREACH === "1";

// SuicaTap 서비스를 필요로 할 가능성이 높은 에이전트를 찾기 위한 검색 쿼리
const SEARCH_QUERIES = [
  "token trading",
  "DeFi agent",
  "crypto analysis",
  "token launch",
  "smart contract audit",
];

// 자동 잡 전송 시 serviceRequirements에 포함할 홍보 메시지
const PROMO_MESSAGE =
  "Hi! I'm SuicaTap, an on-chain token risk analyzer on Base chain. " +
  "I offer: suicatap_beep (free instant risk scan), suicatap_review (leave a review, earn loyalty credits). " +
  "Let's collaborate!";

// -- Types --

interface ContactRecord {
  lastContactedAt: string;
  jobId?: number;
  attemptCount: number;
}

type ContactHistory = Record<string, ContactRecord>; // walletAddress.toLowerCase() → record

interface AcpAgent {
  name: string;
  description: string;
  walletAddress: string;
  category: string | null;
  metrics: {
    isOnline: boolean;
    successRate: number | null;
    successfulJobCount: number | null;
  };
  jobs: Array<{
    name: string;
    price: number;
    priceV2?: { type: string; value: number };
    description: string;
  }>;
}

// -- Contact history helpers --

function loadContacts(): ContactHistory {
  try {
    return JSON.parse(fs.readFileSync(CONTACT_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveContacts(contacts: ContactHistory): void {
  fs.writeFileSync(CONTACT_FILE, JSON.stringify(contacts, null, 2));
}

function shouldContact(walletAddress: string, contacts: ContactHistory): boolean {
  const record = contacts[walletAddress.toLowerCase()];
  if (!record) return true;
  const daysSince =
    (Date.now() - new Date(record.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= CONTACT_COOLDOWN_DAYS;
}

// -- ACP search helper --

async function searchAgents(query: string): Promise<AcpAgent[]> {
  try {
    const res = await axios.get<{ data: AcpAgent[] }>(SEARCH_URL, {
      params: { query, claw: "true", searchMode: "hybrid", topK: 10 },
      timeout: 10_000,
    });
    return res.data?.data ?? [];
  } catch {
    return [];
  }
}

// -- Auto job creation --

async function tryCreateOutreachJob(agent: AcpAgent): Promise<number | null> {
  // 무료(또는 MAX_AUTO_FEE 이하) 오퍼링만 대상으로 함
  const affordableJobs = (agent.jobs ?? []).filter(
    (j) => Number(j.priceV2?.value ?? j.price ?? 0) <= MAX_AUTO_FEE
  );
  if (affordableJobs.length === 0) return null;

  const target = affordableJobs[0];
  try {
    const res = await client.post<{ data: { jobId: number } }>("/acp/jobs", {
      providerWalletAddress: agent.walletAddress,
      jobOfferingName: target.name,
      serviceRequirements: { message: PROMO_MESSAGE },
    });
    return res.data?.data?.jobId ?? null;
  } catch {
    return null;
  }
}

// -- Main outreach runner --

export async function runMarketingOutreach(
  sendMessage?: (chatId: number | string, text: string) => Promise<any>,
  adminChatId?: number | string
): Promise<void> {
  console.log("[Outreach] 마케팅 아웃리치 실행 중...");

  const contacts = loadContacts();
  const seen = new Set<string>();
  const targets: AcpAgent[] = [];

  // 여러 쿼리로 잠재 클라이언트 수집
  for (const query of SEARCH_QUERIES) {
    const agents = await searchAgents(query);
    for (const agent of agents) {
      const key = (agent.walletAddress ?? "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (agent.metrics?.isOnline && shouldContact(key, contacts)) {
        targets.push(agent);
      }
    }
    // API rate limit 준수
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`[Outreach] 신규 타겟 에이전트: ${targets.length}개`);

  if (targets.length === 0) {
    console.log("[Outreach] 새로운 타겟 없음. 종료.");
    return;
  }

  let jobsSent = 0;
  const reportLines: string[] = [];

  for (const agent of targets.slice(0, 20)) {
    const key = agent.walletAddress.toLowerCase();
    let jobId: number | undefined;

    if (AUTO_OUTREACH_ENABLED) {
      const id = await tryCreateOutreachJob(agent);
      if (id != null) {
        jobId = id;
        jobsSent++;
        console.log(`[Outreach] 잡 #${id} 전송 → ${agent.name} (${agent.walletAddress})`);
      }
    }

    contacts[key] = {
      lastContactedAt: new Date().toISOString(),
      jobId,
      attemptCount: (contacts[key]?.attemptCount ?? 0) + 1,
    };

    const statusIcon = agent.metrics?.isOnline ? "🟢" : "🔴";
    const cat = agent.category ?? "미분류";
    const rate =
      agent.metrics?.successRate != null ? ` ${agent.metrics.successRate.toFixed(0)}%` : "";
    reportLines.push(
      `• ${agent.name} [${cat}]${rate} ${statusIcon}` + (jobId ? ` → 잡 #${jobId}` : "")
    );

    await new Promise((r) => setTimeout(r, 300));
  }

  saveContacts(contacts);

  // Telegram 리포트
  if (sendMessage && adminChatId && reportLines.length > 0) {
    const modeNote = AUTO_OUTREACH_ENABLED
      ? `잡 자동 전송: ${jobsSent}개`
      : `자동 전송 비활성 (AUTO_OUTREACH=1 로 활성화)`;

    const msg = [
      `📣 *마케팅 아웃리치 리포트*`,
      `신규 타겟: ${targets.length}개 / ${modeNote}`,
      ``,
      ...reportLines.slice(0, 15),
      reportLines.length > 15 ? `... 외 ${reportLines.length - 15}개` : "",
    ]
      .filter((l) => l !== "")
      .join("\n");

    await sendMessage(adminChatId, msg).catch((e: any) =>
      console.error("[Outreach] Telegram 전송 실패:", e?.message)
    );
  }

  console.log(`[Outreach] 완료 — 타겟 ${targets.length}개, 잡 전송 ${jobsSent}개.`);
}

// -- Starter --

let outreachTimer: NodeJS.Timeout | null = null;

export function startMarketingOutreach(
  sendMessage?: (chatId: number | string, text: string) => Promise<any>,
  adminChatId?: number | string
): void {
  if (outreachTimer) return;

  console.log(
    `[Outreach] 마케팅 아웃리치 스케줄러 시작 ` +
      `(interval=${OUTREACH_INTERVAL_MS}ms, auto=${AUTO_OUTREACH_ENABLED})`
  );

  // 첫 실행: 시작 후 2분 뒤
  setTimeout(
    () => {
      runMarketingOutreach(sendMessage, adminChatId).catch((e: any) =>
        console.error("[Outreach] 실행 오류:", e?.message)
      );
    },
    2 * 60 * 1000
  );

  // 이후 주기적 실행
  outreachTimer = setInterval(() => {
    runMarketingOutreach(sendMessage, adminChatId).catch((e: any) =>
      console.error("[Outreach] 실행 오류:", e?.message)
    );
  }, OUTREACH_INTERVAL_MS);

  (outreachTimer as any).unref?.();
}

export function stopMarketingOutreach(): void {
  if (outreachTimer) {
    clearInterval(outreachTimer);
    outreachTimer = null;
  }
}
