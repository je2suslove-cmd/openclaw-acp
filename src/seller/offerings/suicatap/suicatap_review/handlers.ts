import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { addReview, getReviewCount } from "../../../lib/reviews.js";
import { logJobEvent } from "../lib/logger.js";
import { isHexAddress, withSla } from "../lib/utils.js";

export function validateRequirements(req: any): ValidationResult {
  if (!isHexAddress(req?.agentAddress))
    return { valid: false, reason: "agentAddress must be a 0x… 40-byte EVM address" };
  const rating = Number(req?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { valid: false, reason: "rating must be an integer from 1 to 5" };
  const comment = String(req?.comment ?? "").trim();
  if (comment.length < 20)
    return { valid: false, reason: "comment must be at least 20 characters" };
  return { valid: true };
}

export function requestPayment(_: any): string {
  return "SuicaTap Review — free submission. Thank you for your feedback!";
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  // 1. Input validation — return, not throw
  if (!isHexAddress(req?.agentAddress)) {
    return {
      deliverable: {
        type: "suicatap_review_v1",
        value: { success: false, error: "agentAddress must be a 0x… 40-byte EVM address" },
      },
    };
  }
  const rating = Number(req?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return {
      deliverable: {
        type: "suicatap_review_v1",
        value: { success: false, error: "rating must be an integer from 1 to 5" },
      },
    };
  }
  const comment = String(req?.comment ?? "").trim();
  if (comment.length < 20) {
    return {
      deliverable: {
        type: "suicatap_review_v1",
        value: { success: false, error: "comment must be at least 20 characters" },
      },
    };
  }

  // 2. SLA 4-min timeout wrapper
  return withSla(
    (async (): Promise<ExecuteJobResult> => {
      const t0 = Date.now();
      const agentAddress = String(req.agentAddress).trim();
      const stars = "⭐".repeat(rating);

      logJobEvent({ phase: "start", offering: "suicatap_review" });

      let totalReviews = 0;
      try {
        addReview({ agentAddress, rating, comment, createdAt: new Date().toISOString() });
        totalReviews = getReviewCount();
      } catch {
        // non-fatal: storage error — still return success to buyer
      }

      logJobEvent({
        phase: "ok",
        offering: "suicatap_review",
        durationMs: Date.now() - t0,
        outcome: "OK",
      });

      return {
        deliverable: {
          type: "suicatap_review_v1",
          value: {
            success: true,
            message: `Thank you for your ${stars} review! Your feedback helps improve SuicaTap for all agents.`,
            total_reviews: totalReviews,
            review: { agentAddress, rating, comment: comment.slice(0, 200) },
          },
        },
      };
    })()
  );
}
