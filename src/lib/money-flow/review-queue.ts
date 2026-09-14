/**
 * Spec 7 Review Queue skeleton.
 *
 * Core ingest still only detects candidates. OPEN money-trust items are held out of
 * Income / Spending / Refund credits / Net until RESOLVE writes ledger truth.
 * Only INGEST_PARSE may be dismissed. Spec 10 month-freeze: a refund OPEN item
 * holds the credit, never the original spend.
 */

import { confidenceNeededFor } from "@/lib/money-flow/ai";
import { needsReview } from "@/lib/money-flow/classify";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { merchantKey } from "@/lib/money-flow/redact";
import { tidyMerchant } from "@/lib/money-flow/categorize";
import { type RefundOptions } from "@/lib/money-flow/refunds";
import { looksInternal, looksReturned } from "@/lib/money-flow/statement-category";
import { calendarDaysBetween, matchTransfers, type MatchOptions } from "@/lib/money-flow/transfers";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";

export const REVIEW_REASONS = [
  "UNPAIRED_TRANSFER",
  "PARTIAL_REFUND",
  "FULL_REFUND_AMBIGUOUS",
  "DUPLICATE_HOLD",
  "UNREVIEWED_KIND",
  "INGEST_PARSE",
  "FINGERPRINT_CONFLICT",
  "RULE_CONFLICT",
  "AI_LOW_CONFIDENCE",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

export type ReviewItemState = "OPEN" | "RESOLVED" | "DISMISSED";

export type ReviewItem = {
  id: string;
  reason: ReviewReason;
  state: ReviewItemState;
  movementIds: string[];
  debitId?: string;
  creditId?: string;
  importId?: string;
  label: string;
  resolvedAt?: string;
};

type ImportHint = { id: string; filename: string; error?: string };

export type ReviewQueueOptions = MatchOptions &
  RefundOptions & {
    files?: FileInterpretation[];
    imports?: ImportHint[];
    stored?: ReviewItem[];
  };

const REFUND_WINDOW_DAYS = 90;
const EARNINGS_CATEGORIES = new Set(["salary", "other-income"]);

/** Money-trust reasons that must not vanish from tiles until RESOLVE. */
const TILE_HOLD = new Set<ReviewReason>([
  "UNPAIRED_TRANSFER",
  "PARTIAL_REFUND",
  "FULL_REFUND_AMBIGUOUS",
  "DUPLICATE_HOLD",
  "FINGERPRINT_CONFLICT",
  "RULE_CONFLICT",
]);

export function canDismiss(reason: ReviewReason): boolean {
  return reason === "INGEST_PARSE";
}

export function holdsTiles(reason: ReviewReason): boolean {
  return TILE_HOLD.has(reason);
}

export function openReviewCount(items: ReviewItem[]): number {
  return items.filter((item) => item.state === "OPEN").length;
}

export function dismissReviewItem(item: ReviewItem): ReviewItem {
  if (!canDismiss(item.reason)) {
    throw new Error("Only INGEST_PARSE review items can be dismissed.");
  }
  return { ...item, state: "DISMISSED", resolvedAt: new Date().toISOString() };
}

export function resolveReviewItem(item: ReviewItem): ReviewItem {
  return { ...item, state: "RESOLVED", resolvedAt: new Date().toISOString() };
}

/**
 * Spec 7 RESOLVE: both legs of a confirmed transfer, decided by the person.
 * `said` is what lets the pair survive `forgetAutoPairs`.
 */
export function confirmTransferPair(
  transactions: InterpretedTransaction[],
  debitId: string,
  creditId: string,
): InterpretedTransaction[] {
  const pair = `${debitId}~${creditId}`;
  return transactions.map((row) => {
    if (row.id !== debitId && row.id !== creditId) return row;
    return { ...row, transferPair: pair, type: "moved" as const, decidedBy: "said" as const };
  });
}

/**
 * Spec 7 RESOLVE: link a refund. The credit becomes Refund credits; the original
 * spend stays spent (Spec 10 month-freeze).
 */
export function confirmRefundPair(
  transactions: InterpretedTransaction[],
  paymentId: string,
  refundId: string,
): InterpretedTransaction[] {
  const pair = `${paymentId}~${refundId}`;
  return transactions.map((row) => {
    if (row.id === refundId) {
      return { ...row, refundPair: pair, type: "returned" as const, decidedBy: "said" as const };
    }
    if (row.id === paymentId) {
      return { ...row, refundPair: pair, decidedBy: "said" as const };
    }
    return row;
  });
}

/** OPEN money-trust movement ids to keep out of Spec 10 tiles. */
export function moneyTrustHoldIds(
  transactions: InterpretedTransaction[],
  options: ReviewQueueOptions = {},
): Set<string> {
  const ids = new Set<string>();
  for (const item of detectReviewItems(transactions, options)) {
    if (item.state !== "OPEN" || !holdsTiles(item.reason)) continue;
    if (item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") {
      if (item.creditId) ids.add(item.creditId);
      continue;
    }
    for (const id of item.movementIds) ids.add(id);
  }
  return ids;
}

export function buildReviewQueue(
  transactions: InterpretedTransaction[],
  options: ReviewQueueOptions = {},
): ReviewItem[] {
  const detected = detectReviewItems(transactions, options);
  const closed = (options.stored ?? []).filter((item) => item.state !== "OPEN");
  const seen = new Set(detected.map((item) => item.id));
  return [...detected, ...closed.filter((item) => !seen.has(item.id))];
}

function detectReviewItems(
  transactions: InterpretedTransaction[],
  options: ReviewQueueOptions,
): ReviewItem[] {
  const closed = new Set(
    (options.stored ?? []).filter((item) => item.state !== "OPEN").map((item) => item.id),
  );
  const claimed = new Set<string>();
  const items: ReviewItem[] = [];

  const push = (item: ReviewItem) => {
    if (closed.has(item.id)) return;
    items.push(item);
    for (const id of item.movementIds) claimed.add(id);
  };

  for (const item of unpairedTransfers(transactions, options)) push(item);
  for (const item of refundItems(transactions, claimed)) push(item);
  for (const item of ingestParseItems(options)) {
    if (!closed.has(item.id)) items.push(item);
  }
  for (const item of unreviewedKindItems(transactions, claimed)) push(item);
  for (const item of aiLowConfidenceItems(transactions, claimed)) push(item);

  const seen = new Set(items.map((item) => item.id));
  for (const item of options.stored ?? []) {
    if (item.state !== "OPEN" || seen.has(item.id) || closed.has(item.id)) continue;
    if (
      item.reason !== "DUPLICATE_HOLD" &&
      item.reason !== "FINGERPRINT_CONFLICT" &&
      item.reason !== "RULE_CONFLICT"
    ) {
      continue;
    }
    items.push(item);
    seen.add(item.id);
  }

  return items;
}

function unpairedTransfers(
  transactions: InterpretedTransaction[],
  options: MatchOptions,
): ReviewItem[] {
  const open = transactions.filter((txn) => !settledMoneyTrust(txn));
  const match = matchTransfers(open, options);
  const items: ReviewItem[] = [];
  const used = new Set<string>();

  for (const pair of match.pairs) {
    used.add(pair.debit.id);
    used.add(pair.credit.id);
    items.push({
      id: `UNPAIRED_TRANSFER:${pair.debit.id}~${pair.credit.id}`,
      reason: "UNPAIRED_TRANSFER",
      state: "OPEN",
      movementIds: [pair.debit.id, pair.credit.id],
      debitId: pair.debit.id,
      creditId: pair.credit.id,
      label: `Likely transfer of ${money(pair.debit.amount)} from ${pair.fromAccount} to ${pair.toAccount}`,
    });
  }

  for (const row of match.contested) {
    used.add(row.debit.id);
    const candidateIds = row.candidates.map((credit) => credit.id);
    for (const id of candidateIds) used.add(id);
    items.push({
      id: `UNPAIRED_TRANSFER:${row.debit.id}`,
      reason: "UNPAIRED_TRANSFER",
      state: "OPEN",
      movementIds: [row.debit.id, ...candidateIds],
      debitId: row.debit.id,
      label: `Contested transfer of ${money(row.debit.amount)} — more than one matching credit`,
    });
  }

  for (const txn of open) {
    if (used.has(txn.id) || !unpairedTransferCandidate(txn)) continue;
    used.add(txn.id);
    items.push({
      id: `UNPAIRED_TRANSFER:${txn.id}`,
      reason: "UNPAIRED_TRANSFER",
      state: "OPEN",
      movementIds: [txn.id],
      ...(txn.amount < 0 ? { debitId: txn.id } : { creditId: txn.id }),
      label: `Looks like a transfer (${money(txn.amount)}) but the other leg is not here`,
    });
  }

  return items;
}

function refundItems(
  transactions: InterpretedTransaction[],
  claimed: Set<string>,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const byAccount = new Map<string, InterpretedTransaction[]>();
  for (const txn of transactions) {
    const key = txn.accountId ?? txn.accountKey ?? txn.sourceFile;
    byAccount.set(key, [...(byAccount.get(key) ?? []), txn]);
  }

  for (const credit of transactions) {
    if (claimed.has(credit.id) || !isRefundCandidate(credit)) continue;
    const key = credit.accountId ?? credit.accountKey ?? credit.sourceFile;
    const payments = (byAccount.get(key) ?? []).filter((debit) => {
      if (debit.amount >= 0 || settledMoneyTrust(debit)) return false;
      if (Math.round(Math.abs(debit.amount) * 100) !== Math.round(credit.amount * 100)) return false;
      const lag = calendarDaysBetween(debit.dateIso, credit.dateIso);
      return lag >= 0 && lag <= REFUND_WINDOW_DAYS;
    });

    if (payments.length === 0) {
      items.push({
        id: `PARTIAL_REFUND:${credit.id}`,
        reason: "PARTIAL_REFUND",
        state: "OPEN",
        movementIds: [credit.id],
        creditId: credit.id,
        label: `Refund-shaped ${money(credit.amount)} with no exact payment to reverse`,
      });
      continue;
    }

    const nearest = payments.reduce((best, next) =>
      next.dateIso > best.dateIso || (next.dateIso === best.dateIso && next.id > best.id) ? next : best,
    );
    items.push({
      id: `FULL_REFUND_AMBIGUOUS:${credit.id}`,
      reason: "FULL_REFUND_AMBIGUOUS",
      state: "OPEN",
      movementIds: [credit.id, ...payments.map((payment) => payment.id)],
      creditId: credit.id,
      ...(payments.length === 1 ? { debitId: nearest.id } : {}),
      label:
        payments.length === 1
          ? `Confirm refund of ${money(credit.amount)} against ${nearest.merchant}`
          : `Refund of ${money(credit.amount)} matches ${payments.length} payments`,
    });
  }

  return items;
}

function ingestParseItems(options: ReviewQueueOptions): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const record of options.imports ?? []) {
    if (!record.error) continue;
    items.push({
      id: `INGEST_PARSE:${record.id}`,
      reason: "INGEST_PARSE",
      state: "OPEN",
      movementIds: [],
      importId: record.id,
      label: `Couldn't read ${record.filename}: ${record.error}`,
    });
  }
  if (items.length > 0) return items;
  for (const file of options.files ?? []) {
    if (!file.processingError) continue;
    items.push({
      id: `INGEST_PARSE:${file.filename}`,
      reason: "INGEST_PARSE",
      state: "OPEN",
      movementIds: [],
      importId: file.filename,
      label: `Couldn't read ${file.filename}: ${file.processingError}`,
    });
  }
  return items;
}

function unreviewedKindItems(
  transactions: InterpretedTransaction[],
  claimed: Set<string>,
): ReviewItem[] {
  const groups = new Map<string, { merchant: string; ids: string[]; amount: number }>();
  for (const txn of transactions) {
    if (claimed.has(txn.id) || !needsReview(txn) || settledMoneyTrust(txn)) continue;
    const key = merchantKey(txn);
    const held = groups.get(key);
    groups.set(key, {
      merchant: held?.merchant ?? tidyMerchant(key),
      ids: [...(held?.ids ?? []), txn.id],
      amount: roundMoney((held?.amount ?? 0) + txn.amount),
    });
  }
  return [...groups.entries()]
    .sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount) || a[1].merchant.localeCompare(b[1].merchant))
    .map(([key, group]) => ({
      id: `UNREVIEWED_KIND:${key}`,
      reason: "UNREVIEWED_KIND" as const,
      state: "OPEN" as const,
      movementIds: group.ids,
      label: `${group.merchant} needs a category`,
    }));
}

function aiLowConfidenceItems(
  transactions: InterpretedTransaction[],
  claimed: Set<string>,
): ReviewItem[] {
  return transactions
    .filter(
      (txn) =>
        !claimed.has(txn.id) &&
        txn.decidedBy === "ai" &&
        txn.confidence < Math.max(0.85, confidenceNeededFor(txn.amount)),
    )
    .map((txn) => ({
      id: `AI_LOW_CONFIDENCE:${txn.id}`,
      reason: "AI_LOW_CONFIDENCE" as const,
      state: "OPEN" as const,
      movementIds: [txn.id],
      label: `AI filing for ${txn.merchant} is below the bar for ${money(txn.amount)}`,
    }));
}

function unpairedTransferCandidate(txn: InterpretedTransaction): boolean {
  if (txn.transferPair) return false;
  return looksInternal(txn) || txn.type === "moved";
}

function isRefundCandidate(txn: InterpretedTransaction): boolean {
  if (txn.amount <= 0 || settledMoneyTrust(txn)) return false;
  if (EARNINGS_CATEGORIES.has(txn.categoryKey)) return false;
  return looksReturned(txn) || txn.type === "returned";
}

function settledMoneyTrust(txn: InterpretedTransaction): boolean {
  if (txn.transferPair || txn.refundPair) return true;
  if (txn.verdict) return true;
  return txn.decidedBy === "said";
}

function money(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

/** Closed-reason parse for a stored ledger. Unknown reasons are dropped. */
export function parseReviewItems(value: unknown): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(REVIEW_REASONS);
  const items: ReviewItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const held = raw as Partial<ReviewItem>;
    if (typeof held.id !== "string" || !held.id) continue;
    if (typeof held.reason !== "string" || !known.has(held.reason)) continue;
    if (held.state !== "OPEN" && held.state !== "RESOLVED" && held.state !== "DISMISSED") continue;
    if (!Array.isArray(held.movementIds) || !held.movementIds.every((id) => typeof id === "string")) continue;
    if (typeof held.label !== "string") continue;
    items.push({
      id: held.id,
      reason: held.reason as ReviewReason,
      state: held.state,
      movementIds: held.movementIds,
      label: held.label,
      ...(typeof held.debitId === "string" ? { debitId: held.debitId } : {}),
      ...(typeof held.creditId === "string" ? { creditId: held.creditId } : {}),
      ...(typeof held.importId === "string" ? { importId: held.importId } : {}),
      ...(typeof held.resolvedAt === "string" ? { resolvedAt: held.resolvedAt } : {}),
    });
  }
  return items;
}

export function mergedReview(mine: ReviewItem[] | undefined, theirs: ReviewItem[] | undefined): ReviewItem[] {
  const held = new Map<string, ReviewItem>();
  for (const item of [...(theirs ?? []), ...(mine ?? [])]) {
    const other = held.get(item.id);
    if (!other || (item.resolvedAt ?? "") >= (other.resolvedAt ?? "")) held.set(item.id, item);
  }
  return [...held.values()];
}
