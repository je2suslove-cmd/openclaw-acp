import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import { addReview, getReviewCount } from "../../../lib/reviews.js";
import { logJobEvent } from "../lib/logger.js";

function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

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
  return "SuicaTap Review — free submission. You'll receive 1 loyalty scan credit.";
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  const t0 = Date.now();
  const agentAddress = String(req.agentAddress).trim();
  const rating = Number(req.rating);
  const comment = String(req.comment).trim();

  logJobEvent({ phase: "start", offering: "suicatap_review" });

  addReview({
    agentAddress,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  });

  const totalReviews = getReviewCount();
  const stars = "⭐".repeat(rating);

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
        message: `Thank you for your ${stars} review! 1 free loyalty scan credit has been granted to ${agentAddress.slice(0, 10)}…`,
        credit_granted: 1,
        redeem_via: "suicatap_loyalty_scan",
        total_reviews: totalReviews,
        review: { agentAddress, rating, comment: comment.slice(0, 200) },
      },
    },
  };
}
