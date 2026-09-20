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

export type ReviewOpenActionId =
  | "confirm"
  | "confirm-refund"
  | "mark-income"
  | "keep-as-money"
  | "assign-category"
  | "skip"
  | "dismiss"
  | "not-that"
  | "keep-filing";

export type ReviewOpenAction = {
  id: ReviewOpenActionId;
  label: string;
  role: "primary" | "secondary";
  enabled: boolean;
};

export type ReviewOpenActionContext = {
  partnerCount: number;
  paymentCount: number;
  selectedPartnerId?: string;
  selectedPaymentId?: string;
  selectedCategoryKey?: string;
  keepAsLabel?: string;
};

/**
 * Spec 7 / Wonder action matrix. Every OPEN reason has an enabled path that is
 * not a lone Not that. Not that only appears when there is a pairing to decline.
 */
export function reviewOpenActions(item: ReviewItem, ctx: ReviewOpenActionContext): ReviewOpenAction[] {
  switch (item.reason) {
    case "UNPAIRED_TRANSFER":
      if (ctx.partnerCount > 0) {
        const hasPick = Boolean(ctx.selectedPartnerId);
        return [
          { id: "confirm", label: "Confirm", role: "primary", enabled: hasPick },
          { id: "not-that", label: "Not that", role: "secondary", enabled: hasPick },
        ];
      }
      return [
        {
          id: "keep-as-money",
          label: ctx.keepAsLabel ?? "Keep as spending",
          role: "primary",
          enabled: true,
        },
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
    case "PARTIAL_REFUND":
    case "FULL_REFUND_AMBIGUOUS": {
      const paymentReady = Boolean(ctx.selectedPaymentId) || ctx.paymentCount === 0;
      const actions: ReviewOpenAction[] = [
        { id: "confirm-refund", label: "Confirm refund", role: "primary", enabled: paymentReady },
        { id: "mark-income", label: "Mark as income", role: "secondary", enabled: true },
      ];
      if (ctx.paymentCount > 1 && ctx.selectedPaymentId) {
        actions.push({ id: "not-that", label: "Not that", role: "secondary", enabled: true });
      }
      return actions;
    }
    case "UNREVIEWED_KIND":
      return [
        {
          id: "assign-category",
          label: "Assign category",
          role: "primary",
          enabled: Boolean(ctx.selectedCategoryKey),
        },
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
    case "INGEST_PARSE":
      return [{ id: "dismiss", label: "Dismiss", role: "primary", enabled: true }];
    default:
      return [
        { id: "keep-filing", label: "Keep this filing", role: "primary", enabled: true },
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
  }
}

export function keepAsMoneyLabel(
  item: ReviewItem,
  byId: Map<string, InterpretedTransaction>,
): string {
  const debit = item.debitId ? byId.get(item.debitId) : undefined;
  const credit = item.creditId ? byId.get(item.creditId) : undefined;
  if (credit && !debit) return "Keep as income";
  if (debit) return "Keep as spending";
  const first = item.movementIds.map((id) => byId.get(id)).find((txn): txn is InterpretedTransaction => Boolean(txn));
  return first && first.amount > 0 ? "Keep as income" : "Keep as spending";
}

export function openActionsAreUseful(actions: ReviewOpenAction[]): boolean {
  const enabled = actions.filter((action) => action.enabled);
  if (enabled.length === 0) return false;
  if (enabled.every((action) => action.id === "not-that")) return false;
  return enabled.some((action) => action.role === "primary") || enabled.some((action) => action.id !== "not-that");
}

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
