/**
 * Review C2 selection. Answering stays in the inspector; picking a row opens it,
 * and a resolve moves the selection to the next open row.
 */

import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { REVIEW_REASON_LABEL, type ReviewReasonFilter } from "@/lib/money-flow/review-page";
import type { ReviewItem, ReviewReason } from "@/lib/money-flow/review-queue";

export type ReviewInspectorState = {
  selectedId: string | null;
  open: boolean;
};

export function selectReviewRow(id: string): ReviewInspectorState {
  return { selectedId: id, open: true };
}

export function inspectorIsOpen(state: ReviewInspectorState): boolean {
  return state.open && state.selectedId !== null;
}

/** The row after the ones just answered, or the previous row when the last one goes. */
export function selectionAfterAnswer(ids: string[], removedIds: string[]): string | null {
  const removed = new Set(removedIds);
  const firstRemoved = ids.findIndex((id) => removed.has(id));
  if (firstRemoved < 0) return ids.find((id) => !removed.has(id)) ?? null;
  for (let index = firstRemoved + 1; index < ids.length; index += 1) {
    if (!removed.has(ids[index]!)) return ids[index]!;
  }
  for (let index = firstRemoved - 1; index >= 0; index -= 1) {
    if (!removed.has(ids[index]!)) return ids[index]!;
  }
  return null;
}

export function applyReviewAnswer(ids: string[], answeredId: string): ReviewInspectorState {
  const selectedId = selectionAfterAnswer(ids, [answeredId]);
  return { selectedId, open: selectedId !== null };
}

export function stepReviewSelection(ids: string[], selectedId: string | null, direction: 1 | -1): string | null {
  if (ids.length === 0) return null;
  if (!selectedId) return direction > 0 ? ids[0]! : ids[ids.length - 1]!;
  const index = ids.indexOf(selectedId);
  if (index < 0) return ids[0]!;
  const next = index + direction;
  if (next < 0 || next >= ids.length) return selectedId;
  return ids[next]!;
}

export function pageIndexForId(ids: string[], id: string | null, size: number): number {
  if (!id || size <= 0) return 0;
  const index = ids.indexOf(id);
  if (index < 0) return 0;
  return Math.floor(index / size);
}

const GROUP_ORDER = ["Transfers", "Refunds", "Categories", "Other"] as const;

export type ReviewLedgerGroup = (typeof GROUP_ORDER)[number];

export function reviewLedgerGroup(reason: ReviewReason): ReviewLedgerGroup {
  if (reason === "UNPAIRED_TRANSFER") return "Transfers";
  if (reason === "PARTIAL_REFUND" || reason === "FULL_REFUND_AMBIGUOUS") return "Refunds";
  if (reason === "UNREVIEWED_KIND") return "Categories";
  return "Other";
}

export function groupReviewRows<T extends { group: string }>(rows: T[]): { label: string; rows: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const list = buckets.get(row.group) ?? [];
    list.push(row);
    buckets.set(row.group, list);
  }
  return GROUP_ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    rows: buckets.get(label)!,
  }));
}

export function reviewRowTitle(item: ReviewItem, merchant?: string): string {
  if (merchant?.trim()) return merchant.trim();
  return item.label.replace(/ needs a category$/i, "");
}

export function reviewRowCaption(
  reason: ReviewReason,
  options: { partnerCount: number; paymentCount: number; credit?: boolean },
): string {
  if (reason === "UNPAIRED_TRANSFER") {
    if (options.partnerCount > 1) return `${options.partnerCount} suggested partners`;
    if (options.partnerCount === 1) return "Suggested partner";
    return options.credit ? "No matching withdrawal" : "No matching deposit";
  }
  if (reason === "PARTIAL_REFUND" || reason === "FULL_REFUND_AMBIGUOUS") {
    if (options.paymentCount > 1) return `${options.paymentCount} possible purchases`;
    return "Possible refund";
  }
  if (reason === "UNREVIEWED_KIND") return "Needs a category";
  return REVIEW_REASON_LABEL[reason];
}

export function reviewInspectorEyebrow(
  item: ReviewItem,
  options: { partnerCount: number; history: boolean; deferred: boolean },
): string {
  if (options.history) return item.state === "DISMISSED" ? "DISMISSED" : "CONFIRMED";
  if (options.deferred) return "SKIPPED";
  if (item.reason === "UNPAIRED_TRANSFER" && options.partnerCount === 0) return "TRANSFER · NO MATCH";
  if (item.reason === "UNPAIRED_TRANSFER") return "TRANSFER";
  if (item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") return "REFUND";
  if (item.reason === "UNREVIEWED_KIND") return "CATEGORY";
  return REVIEW_REASON_LABEL[item.reason].toUpperCase();
}

export function reviewInspectorQuestion(
  item: ReviewItem,
  options: { partnerCount: number; history: boolean },
): string | null {
  if (options.history) return null;
  if (item.reason === "UNPAIRED_TRANSFER" && options.partnerCount === 0) {
    return "Is this money you moved to yourself or someone you track elsewhere?";
  }
  if (item.reason === "UNPAIRED_TRANSFER") return "Which deposit matches this transfer?";
  if (item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") {
    return "Looks like a refund. Confirm to keep it as Refund, or mark as income if it is not.";
  }
  if (item.reason === "UNREVIEWED_KIND") return "Pick a category.";
  return null;
}

export function formatReviewWeekday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${formatDisplayDate(iso)}`;
}

export const REVIEW_SURFACE_REASONS: { id: Exclude<ReviewReasonFilter, "skipped">; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unpaired", label: "Transfers" },
  { id: "refund", label: "Refunds" },
  { id: "needs_category", label: "Categories" },
];
