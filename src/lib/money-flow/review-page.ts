/**
 * Spec 7 Review page helpers: Open / History surfaces, reason_code chips,
 * account + last-30-days filters, and the nav badge (OPEN only).
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { calendarDate } from "@/lib/money-flow/period";
import {
  openReviewCount,
  type ReviewItem,
  type ReviewReason,
} from "@/lib/money-flow/review-queue";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type ReviewSurface = "open" | "history";

export type ReviewReasonFilter = "all" | "unpaired" | "refund" | "needs_category";

export const REVIEW_REASON_FILTERS: { id: ReviewReasonFilter; label: string; reasons?: ReviewReason[] }[] = [
  { id: "all", label: "All" },
  { id: "unpaired", label: "Unpaired", reasons: ["UNPAIRED_TRANSFER"] },
  { id: "refund", label: "Refund", reasons: ["PARTIAL_REFUND", "FULL_REFUND_AMBIGUOUS"] },
  { id: "needs_category", label: "Needs category", reasons: ["UNREVIEWED_KIND"] },
];

export type ReviewPageFilter = {
  surface: ReviewSurface;
  reason: ReviewReasonFilter;
  accountId?: string;
  sinceIso?: string;
};

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  UNPAIRED_TRANSFER: "Unpaired transfer",
  PARTIAL_REFUND: "Possible refund",
  FULL_REFUND_AMBIGUOUS: "Possible refund",
  DUPLICATE_HOLD: "Duplicate hold",
  UNREVIEWED_KIND: "Needs a category",
  INGEST_PARSE: "Ingest parse issue",
  FINGERPRINT_CONFLICT: "Fingerprint conflict",
  RULE_CONFLICT: "Rule conflict",
  AI_LOW_CONFIDENCE: "AI wasn't sure",
};

export function reviewNavBadgeCount(items: ReviewItem[]): number {
  return openReviewCount(items);
}

export function last30DaysSince(todayIso: string): string {
  const day = calendarDate(todayIso);
  const start = Date.parse(`${day}T00:00:00Z`) - 29 * 86400000;
  return new Date(start).toISOString().slice(0, 10);
}

export function filterReviewItems(
  items: ReviewItem[],
  filter: ReviewPageFilter,
  transactions: InterpretedTransaction[] = [],
  registry: AccountRegistry = {},
): ReviewItem[] {
  const reasons = REVIEW_REASON_FILTERS.find((row) => row.id === filter.reason)?.reasons;
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  return items.filter((item) => {
    if (filter.surface === "open" && item.state !== "OPEN") return false;
    if (filter.surface === "history" && item.state === "OPEN") return false;
    if (reasons && !reasons.includes(item.reason)) return false;
    if (filter.accountId && !itemTouchesAccount(item, filter.accountId, byId, registry)) return false;
    if (filter.sinceIso && !itemOnOrAfter(item, filter.sinceIso, byId)) return false;
    return true;
  });
}

export function reviewOpenedOn(
  item: ReviewItem,
  transactions: InterpretedTransaction[] = [],
): string | undefined {
  if (item.resolvedAt) return calendarDate(item.resolvedAt);
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  const dates = item.movementIds
    .map((id) => byId.get(id)?.dateIso)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0];
}

export function itemTouchesAccount(
  item: ReviewItem,
  accountId: string,
  byId: Map<string, InterpretedTransaction>,
  registry: AccountRegistry = {},
): boolean {
  return item.movementIds.some((id) => {
    const txn = byId.get(id);
    return txn ? accountIdOf(txn, registry) === accountId : false;
  });
}

function itemOnOrAfter(
  item: ReviewItem,
  sinceIso: string,
  byId: Map<string, InterpretedTransaction>,
): boolean {
  if (item.resolvedAt && calendarDate(item.resolvedAt) >= sinceIso) return true;
  const dates = item.movementIds.map((id) => byId.get(id)?.dateIso).filter((date): date is string => Boolean(date));
  if (dates.length === 0) return true;
  return dates.some((date) => date >= sinceIso);
}

export function hasOpenTransferItems(items: ReviewItem[]): boolean {
  return items.some((item) => item.state === "OPEN" && item.reason === "UNPAIRED_TRANSFER");
}
