import * as fs from "fs";
import * as path from "path";
import client from "../lib/client.js";
import {
  listActiveBounties,
  getMatchStatus,
  saveActiveBounty,
  removeActiveBounty,
  syncBountyJobStatus,
  fetchOpenBounties,
  applyToBounty,
  type MarketplaceBounty,
} from "../lib/bounty.js";
import { removeBountyPollCronIfUnused } from "../lib/openclawCron.js";
import { ROOT } from "../lib/config.js";

// =============================================================================
// Config
// =============================================================================

const MATCH_KEYWORDS = ["token", "risk", "safety", "honeypot", "rug", "scan", "check"];

// Budget threshold (USDC): above this → full report, below → quick beep
const REPORT_BUDGET_THRESHOLD = 0.3;

// Applied bounty IDs persist across restarts to avoid duplicate Telegram alerts
const APPLIED_PATH = path.resolve(ROOT, "applied-bounties.json");

// =============================================================================
// Applied-bounty persistence
// =============================================================================

interface AppliedEntry {
  id: string;
  appliedAt: string;
}

// In-memory set, loaded from disk at startup
const appliedIds = new Set<string>();

function loadAppliedIds(): void {
  try {
    if (!fs.existsSync(APPLIED_PATH)) return;
    const entries: AppliedEntry[] = JSON.parse(fs.readFileSync(APPLIED_PATH, "utf-8"));
    if (!Array.isArray(entries)) return;
    // Keep only last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const e of entries) {
      if (new Date(e.appliedAt).getTime() > cutoff) {
        appliedIds.add(e.id);
      }
    }
  } catch {
    // non-fatal
  }
}

function persistAppliedId(id: string): void {
  appliedIds.add(id);
  try {
    let entries: AppliedEntry[] = [];
    if (fs.existsSync(APPLIED_PATH)) {
      try {
        entries = JSON.parse(fs.readFileSync(APPLIED_PATH, "utf-8"));
      } catch {
        entries = [];
      }
    }
    if (!Array.isArray(entries)) entries = [];
    entries.push({ id, appliedAt: new Date().toISOString() });
    // Cap at 1000 entries
    if (entries.length > 1000) entries = entries.slice(-1000);
    fs.writeFileSync(APPLIED_PATH, JSON.stringify(entries, null, 2) + "\n");
  } catch {
    // non-fatal — in-memory set is still updated
  }
}

// =============================================================================
// Helpers
// =============================================================================

function log(msg: string) {
  console.log(`[BountyPoller] ${msg}`);
}

function candidateField(c: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isRelevantBounty(b: MarketplaceBounty): boolean {
  const text = `${b.title ?? ""} ${b.description ?? ""} ${b.tags ?? ""}`.toLowerCase();
  return MATCH_KEYWORDS.some((kw) => text.includes(kw));
}

function pickOffering(b: MarketplaceBounty): string {
  return b.budget >= REPORT_BUDGET_THRESHOLD ? "suicatap_report" : "suicatap_beep";
}

function bountyId(b: MarketplaceBounty): string {
  return String(b.id ?? b.bountyId ?? "");
}

// =============================================================================
// Core: scan ACP marketplace and auto-bid on matching bounties
// =============================================================================

async function scanAndBid(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): Promise<void> {
  const bounties = await fetchOpenBounties();
  if (bounties.length === 0) {
    log("Marketplace scan: no open bounties found");
    return;
  }

  log(`Marketplace scan: ${bounties.length} open bounty/bounties`);

  for (const b of bounties) {
    const id = bountyId(b);
    if (!id) continue;

    // Skip already applied
    if (appliedIds.has(id)) continue;

    // Skip non-relevant
    if (!isRelevantBounty(b)) continue;

    const offering = pickOffering(b);
    log(`Bidding on #${id} "${b.title}" (budget=$${b.budget}) with ${offering}`);

    const result = await applyToBounty(id, offering);

    // Always mark as applied to prevent retry spam (even on failure)
    persistAppliedId(id);

    if (!result.success) {
      // Silently skip: already closed, duplicate, ineligible, etc.
      log(`Bid #${id} skipped: ${result.error ?? "no detail"}`);
      continue;
    }

    log(`Bid #${id} submitted successfully`);

    if (sendMessage && adminChatId) {
      const lines = [
        `🏹 Auto-bid submitted!`,
        `📋 Bounty: "${b.title}"`,
        `💰 Budget: $${b.budget}`,
        `🛡️ Offering: ${offering}`,
      ];
      if (b.description) {
        lines.push(`📝 ${String(b.description).slice(0, 120)}`);
      }
      await sendMessage(adminChatId, lines.join("\n")).catch(() => {});
    }
  }
}

// =============================================================================
// Core: poll tracked bounties (existing flow)
// =============================================================================

async function pollTracked(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): Promise<void> {
  const bounties = listActiveBounties();
  if (bounties.length === 0) return;

  log(`Polling ${bounties.length} tracked bounty/bounties...`);

  for (const b of bounties) {
    try {
      // ── Claimed: track ACP job phase ──
      if (b.status === "claimed" && b.acpJobId) {
        let jobPhase = "";
        let deliverable: string | undefined;

        try {
          const jobRes = await client.get(`/acp/jobs/${b.acpJobId}`);
          const jobData = jobRes.data?.data ?? jobRes.data;
          jobPhase = String(jobData?.phase ?? "").toUpperCase();
          deliverable = jobData?.deliverable ?? undefined;
        } catch {
          log(`Bounty ${b.bountyId}: failed to fetch job ${b.acpJobId} — skipping`);
          continue;
        }

        const isTerminal = ["COMPLETED", "REJECTED", "EXPIRED"].includes(jobPhase);
        if (isTerminal) {
          if (b.posterSecret) {
            try {
              await syncBountyJobStatus({ bountyId: b.bountyId, posterSecret: b.posterSecret });
            } catch {
              // non-fatal
            }
          }
          removeActiveBounty(b.bountyId);
          log(`Bounty ${b.bountyId} "${b.title}" → ${jobPhase} (cleaned)`);

          if (sendMessage && adminChatId) {
            const emoji = jobPhase === "COMPLETED" ? "✅" : "❌";
            const snippet = deliverable ? `\n📦 ${String(deliverable).slice(0, 200)}` : "";
            await sendMessage(
              adminChatId,
              `${emoji} Bounty "${b.title}" → ${jobPhase}${snippet}`
            ).catch(() => {});
          }
        } else {
          log(`Bounty ${b.bountyId} job ${b.acpJobId}: ${jobPhase}`);
        }
        continue;
      }

      // ── Open / pending_match: check remote status ──
      const remote = await getMatchStatus(b.bountyId);
      const status = String(remote.status).toLowerCase();

      if (["fulfilled", "expired", "rejected"].includes(status)) {
        removeActiveBounty(b.bountyId);
        log(`Bounty ${b.bountyId} "${b.title}" terminal (${status}) — cleaned`);
        continue;
      }

      const hasCandidates =
        status === "pending_match" &&
        Array.isArray(remote.candidates) &&
        remote.candidates.length > 0;
      const isNew = hasCandidates && !b.notifiedPendingMatch;

      saveActiveBounty({
        ...b,
        status: remote.status,
        ...(isNew ? { notifiedPendingMatch: true } : {}),
      });

      if (isNew) {
        const count = (remote.candidates as unknown[]).length;
        log(`Bounty ${b.bountyId} "${b.title}": ${count} candidate(s) ready`);

        if (sendMessage && adminChatId) {
          const lines = [`🎯 Bounty "${b.title}" — ${count} candidate(s) ready!`];
          for (const c of (remote.candidates as Record<string, unknown>[]).slice(0, 3)) {
            const name = candidateField(c, ["agent_name", "agentName", "name"]) || "(unknown)";
            const offering =
              candidateField(c, ["job_offering", "jobOffering", "offeringName", "offering_name"]) ||
              "?";
            const price = c.price ?? c.job_offering_price ?? c.jobOfferingPrice ?? c.jobFee ?? "?";
            lines.push(`  • ${name} — ${offering} ($${price})`);
          }
          lines.push(`\n▶ Run: acp bounty select ${b.bountyId}`);
          await sendMessage(adminChatId, lines.join("\n")).catch(() => {});
        }
      } else {
        log(`Bounty ${b.bountyId}: ${status}`);
      }
    } catch (err) {
      log(`Bounty ${b.bountyId}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    removeBountyPollCronIfUnused();
  } catch {
    // non-fatal
  }
}

// =============================================================================
// Poll cycle: scan marketplace first, then track existing bounties
// =============================================================================

async function pollCycle(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): Promise<void> {
  // 1. Scan ACP marketplace and auto-bid on matching bounties
  await scanAndBid(sendMessage, adminChatId);

  // 2. Track status of bounties this agent has posted (as buyer)
  await pollTracked(sendMessage, adminChatId);
}

// =============================================================================
// Public API
// =============================================================================

let pollTimer: NodeJS.Timeout | null = null;

export function startBountyPoller(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): void {
  if (pollTimer) return;

  // Load previously applied IDs to prevent duplicate Telegram alerts on restart
  loadAppliedIds();

  const intervalMs = Number(process.env.BOUNTY_POLL_INTERVAL_MS ?? 10 * 60 * 1000);
  log(`Starting (interval=${intervalMs}ms, applied_cache=${appliedIds.size})`);

  pollTimer = setInterval(() => {
    pollCycle(sendMessage, adminChatId).catch((err) =>
      log(`Poll cycle error: ${err instanceof Error ? err.message : String(err)}`)
    );
  }, intervalMs);

  (pollTimer as any).unref?.();
}

export function stopBountyPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
