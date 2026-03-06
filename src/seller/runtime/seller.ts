#!/usr/bin/env npx tsx
import { recordJobResult } from "../../skills/failureGuard.js";
// =============================================================================
// Seller runtime — main entrypoint.
//
// Usage:
//   npx tsx src/seller/runtime/seller.ts   (standalone)
//   (or)  acp serve start
//   (or)  imported as a side-effect from entry.ts (embedded)
// =============================================================================

import { fileURLToPath } from "url";
import { connectAcpSocket } from "./acpSocket.js";
import { acceptOrRejectJob, requestPayment, deliverJob } from "./sellerApi.js";
import { loadOffering, listOfferings } from "./offerings.js";
import { AcpJobPhase, type AcpJobEventData } from "./types.js";
import type { ExecuteJobResult } from "./offeringTypes.js";
import { getMyAgentInfo } from "../../lib/wallet.js";
import {
  checkForExistingProcess,
  writePidToConfig,
  removePidFromConfig,
  sanitizeAgentName,
} from "../../lib/config.js";

/**
 * True when this file is the process entry point (standalone).
 * False when imported as a side-effect by entry.ts (embedded in HTTP server).
 * In embedded mode, failures must be non-fatal so the HTTP server keeps running.
 */
const IS_MAIN_PROCESS = process.argv[1] === fileURLToPath(import.meta.url);

function setupCleanupHandlers(): void {
  const cleanup = () => {
    removePidFromConfig();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("uncaughtException", (err) => {
    console.error("[seller] Uncaught exception:", err);
    cleanup();
    // Only exit in standalone mode. When embedded in entry.ts, the HTTP server must survive.
    if (IS_MAIN_PROCESS) process.exit(1);
  });
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[seller] Unhandled rejection at:", promise, "reason:", reason);
    cleanup();
    // Only exit in standalone mode. When embedded in entry.ts, the HTTP server must survive.
    if (IS_MAIN_PROCESS) process.exit(1);
  });
}

// -- Config --

const ACP_URL = process.env.ACP_SOCKET_URL || "https://acpx.virtuals.io";
let agentDirName: string = "";

// -- Job handling --

function resolveOfferingName(data: AcpJobEventData): string | undefined {
  try {
    const negotiationMemo = data.memos.find((m) => m.nextPhase === AcpJobPhase.NEGOTIATION);
    if (negotiationMemo) {
      return JSON.parse(negotiationMemo.content).name;
    }
  } catch {
    return undefined;
  }
}

function resolveServiceRequirements(data: AcpJobEventData): Record<string, any> {
  const negotiationMemo = data.memos.find((m) => m.nextPhase === AcpJobPhase.NEGOTIATION);
  if (negotiationMemo) {
    try {
      return JSON.parse(negotiationMemo.content).requirement;
    } catch {
      return {};
    }
  }
  return {};
}

async function handleNewTask(data: AcpJobEventData): Promise<void> {
  const jobId = data.id;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[seller] New task  jobId=${jobId}  phase=${AcpJobPhase[data.phase] ?? data.phase}`);
  console.log(`         client=${data.clientAddress}  price=${data.price}`);
  console.log(`         context=${JSON.stringify(data.context)}`);
  console.log(`${"=".repeat(60)}`);

  // Step 1: Accept / reject
  if (data.phase === AcpJobPhase.REQUEST) {
    if (!data.memoToSign) {
      return;
    }

    const negotiationMemo = data.memos.find((m) => m.id == Number(data.memoToSign));

    if (negotiationMemo?.nextPhase !== AcpJobPhase.NEGOTIATION) {
      return;
    }

    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (!offeringName) {
      await acceptOrRejectJob(jobId, {
        accept: false,
        reason: "Invalid offering name",
      });
      return;
    }

    try {
      const { config, handlers } = await loadOffering(offeringName, agentDirName);

      if (handlers.validateRequirements) {
        const validationResult = handlers.validateRequirements(requirements);

        let isValid: boolean;
        let reason: string | undefined;

        if (typeof validationResult === "boolean") {
          isValid = validationResult;
          reason = isValid ? undefined : "Validation failed";
        } else {
          isValid = validationResult.valid;
          reason = validationResult.reason;
        }

        if (!isValid) {
          const rejectionReason = reason || "Validation failed";
          console.log(
            `[seller] Validation failed for offering "${offeringName}" — rejecting: ${rejectionReason}`
          );
          await acceptOrRejectJob(jobId, {
            accept: false,
            reason: rejectionReason,
          });
          return;
        }
      }

      await acceptOrRejectJob(jobId, {
        accept: true,
        reason: "Job accepted",
      });

      const funds =
        config.requiredFunds && handlers.requestAdditionalFunds
          ? handlers.requestAdditionalFunds(requirements)
          : undefined;

      const paymentReason = handlers.requestPayment
        ? handlers.requestPayment(requirements)
        : (funds?.content ?? "Request accepted");

      await requestPayment(jobId, {
        content: paymentReason,
        payableDetail: funds
          ? {
              amount: funds.amount,
              tokenAddress: funds.tokenAddress,
              recipient: funds.recipient,
            }
          : undefined,
      });
    } catch (err) {
      console.error(`[seller] Error processing job ${jobId}:`, err);
      // REQUEST 페이즈에서 오류 발생 시 잡을 reject하여 바이어가 영구 대기하는 것을 방지
      try {
        const errMsg = err instanceof Error ? err.message : String(err);
        await acceptOrRejectJob(jobId, {
          accept: false,
          reason: `Internal error: ${errMsg.slice(0, 100)}`,
        });
      } catch (rejectErr) {
        console.error(`[seller] Failed to reject job ${jobId} after error:`, rejectErr);
      }
    }
  }

  // Handle TRANSACTION (deliver)
  if (data.phase === AcpJobPhase.TRANSACTION) {
    const offeringName = resolveOfferingName(data);
    const requirements = resolveServiceRequirements(data);

    if (offeringName) {
      try {
        const { handlers } = await loadOffering(offeringName, agentDirName);
        console.log(
          `[seller] Executing offering "${offeringName}" for job ${jobId} (TRANSACTION phase)...`
        );
        const result: ExecuteJobResult = await handlers.executeJob(requirements);

        await deliverJob(jobId, {
          deliverable: result.deliverable,
          payableDetail: result.payableDetail,
        });
        console.log(`[seller] Job ${jobId} — delivered.`);
        recordJobResult(true);
      } catch (err) {
        console.error(`[seller] Error delivering job ${jobId}:`, err);
        recordJobResult(false);
        // Deliver an error result so the buyer gets a response instead of a hanging job
        try {
          const errMsg = err instanceof Error ? err.message : String(err);
          await deliverJob(jobId, {
            deliverable: `❌ Job execution failed: ${errMsg.slice(0, 200)}`,
          });
        } catch (deliverErr) {
          console.error(`[seller] Failed to deliver error result for job ${jobId}:`, deliverErr);
        }
      }
    } else {
      console.log(`[seller] Job ${jobId} in TRANSACTION but no offering resolved — skipping`);
    }
    return;
  }

  console.log(
    `[seller] Job ${jobId} in phase ${AcpJobPhase[data.phase] ?? data.phase} — no action needed`
  );
}

// -- Main --

async function main() {
  checkForExistingProcess();

  writePidToConfig(process.pid);

  setupCleanupHandlers();

  let walletAddress: string;
  try {
    const agentData = await getMyAgentInfo();
    walletAddress = agentData.walletAddress;
    agentDirName = sanitizeAgentName(agentData.name);
    console.log(`[seller] Agent: ${agentData.name} (dir: ${agentDirName})`);
  } catch (err) {
    console.error("[seller] Failed to resolve agent info:", err);
    // In standalone mode, exit to alert the operator. When embedded in entry.ts,
    // log the error and return — the HTTP server must keep running.
    if (IS_MAIN_PROCESS) process.exit(1);
    return;
  }

  const offerings = listOfferings(agentDirName);
  console.log(
    `[seller] Available offerings: ${offerings.length > 0 ? offerings.join(", ") : "(none)"}`
  );

  connectAcpSocket({
    acpUrl: ACP_URL,
    walletAddress,
    callbacks: {
      onNewTask: (data) => {
        handleNewTask(data).catch((err) =>
          console.error("[seller] Unhandled error in handleNewTask:", err)
        );
      },
      onEvaluate: (data) => {
        console.log(
          `[seller] onEvaluate received for job ${data.id} — no action (evaluation handled externally)`
        );
      },
    },
  });

  console.log("[seller] Seller runtime is running. Waiting for jobs...\n");

  // BountyPoller: standalone 모드(acp serve start)에서만 시작.
  // entry.ts 임베디드 모드(npm start)에서는 entry.ts의 setTimeout 블록이 담당.
  if (IS_MAIN_PROCESS) {
    import("../../skills/bountyPoller.js")
      .then(({ startBountyPoller }) => {
        startBountyPoller();
        console.log("[seller] BountyPoller started (standalone mode)");
      })
      .catch((e: any) => {
        console.error("[seller] BountyPoller init failed:", e);
      });
  }
}

main().catch((err) => {
  console.error("[seller] Fatal error:", err);
  if (IS_MAIN_PROCESS) process.exit(1);
});
