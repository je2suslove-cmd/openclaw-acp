// =============================================================================
// Review & Loyalty Credit Store
// Persisted in reviews.json at repo root (git-ignored).
// Agents submit reviews → earn 1 free loyalty scan credit each.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REVIEWS_PATH = path.resolve(__dirname, "../../../reviews.json");

export interface Review {
  agentAddress: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface ReviewStore {
  reviews: Review[];
  credits: Record<string, number>;
}

function readStore(): ReviewStore {
  try {
    return JSON.parse(fs.readFileSync(REVIEWS_PATH, "utf-8")) as ReviewStore;
  } catch {
    return { reviews: [], credits: {} };
  }
}

function writeStore(store: ReviewStore): void {
  try {
    fs.writeFileSync(REVIEWS_PATH, JSON.stringify(store, null, 2) + "\n");
  } catch (e: any) {
    console.error("[reviews] writeStore failed (non-fatal):", e?.message ?? e);
  }
}

/** Add a review and grant 1 loyalty credit to the reviewer. */
export function addReview(review: Review): void {
  try {
    const store = readStore();
    store.reviews.push(review);
    const addr = review.agentAddress.toLowerCase();
    store.credits[addr] = (store.credits[addr] ?? 0) + 1;
    writeStore(store);
  } catch (e: any) {
    console.error("[reviews] addReview failed (non-fatal):", e?.message ?? e);
  }
}

/** Returns true if the agent has at least 1 unused loyalty credit. */
export function hasCredit(agentAddress: string): boolean {
  const store = readStore();
  return (store.credits[agentAddress.toLowerCase()] ?? 0) > 0;
}

/** Consume 1 loyalty credit. Returns true on success, false if no credit. */
export function consumeCredit(agentAddress: string): boolean {
  const store = readStore();
  const addr = agentAddress.toLowerCase();
  if ((store.credits[addr] ?? 0) <= 0) return false;
  store.credits[addr]--;
  writeStore(store);
  return true;
}

/** Returns total review count (for display). */
export function getReviewCount(): number {
  return readStore().reviews.length;
}

/** Returns all reviews (for display/verification). */
export function getReviews(): Review[] {
  return readStore().reviews;
}
