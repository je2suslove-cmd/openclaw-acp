import client from "../lib/client.js";
import {
  listActiveBounties,
  getMatchStatus,
  saveActiveBounty,
  removeActiveBounty,
  syncBountyJobStatus,
} from "../lib/bounty.js";
import { removeBountyPollCronIfUnused } from "../lib/openclawCron.js";

let pollTimer: NodeJS.Timeout | null = null;

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

async function pollCycle(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): Promise<void> {
  const bounties = listActiveBounties();
  if (bounties.length === 0) return;

  log(`Polling ${bounties.length} active bounty/bounties...`);

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

export function startBountyPoller(
  sendMessage?: (chatId: number | string, text: string) => Promise<any> | any,
  adminChatId?: number | string
): void {
  if (pollTimer) return;
  const intervalMs = Number(process.env.BOUNTY_POLL_INTERVAL_MS ?? 10 * 60 * 1000);
  log(`Starting (interval=${intervalMs}ms)`);

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
