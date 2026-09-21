/**
 * Spec 7 Review Undo: last resolve (or a short stack) can be taken back.
 *
 * A settle writes pairs, verdicts, categories, and closed review rows. Undo restores
 * those snapshots so money-trust holds return and Spec 10 tiles match again.
 */

import { parseReviewItems, type ReviewItem } from "@/lib/money-flow/review-queue";
import { forget, type Rules } from "@/lib/money-flow/rules";
import { isTransactionType, type TransactionType } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";
import { verdictFor, type Verdict, type Verdicts } from "@/lib/money-flow/verdicts";

export const REVIEW_UNDO_LIMIT = 5;

export type ReviewUndoMovement = {
  id: string;
  type: TransactionType;
  categoryKey: string;
  decidedBy?: DecidedBy;
  transferPair?: string;
  refundPair?: string;
  tags?: string[];
};

export type ReviewUndoVerdict = {
  key: string;
  prior: Verdict | null;
};

export type ReviewUndoAction = {
  at: string;
  label: string;
  itemIds: string[];
  priorReviews: ReviewItem[];
  verdicts: ReviewUndoVerdict[];
  movements: ReviewUndoMovement[];
  ruleKeys: string[];
};

export function lastReviewUndo(stack: ReviewUndoAction[] | undefined): ReviewUndoAction | undefined {
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
}

export function pushReviewUndo(
  stack: ReviewUndoAction[] | undefined,
  action: ReviewUndoAction,
): ReviewUndoAction[] {
  return [...(stack ?? []), action].slice(-REVIEW_UNDO_LIMIT);
}

export function captureReviewUndo(input: {
  review?: ReviewItem[];
  verdicts?: Verdicts;
  transactions: InterpretedTransaction[];
  label: string;
  items: ReviewItem[];
  movementIds: string[];
  verdictKeys: string[];
  ruleKeys?: string[];
}): ReviewUndoAction {
  const stored = new Map((input.review ?? []).map((row) => [row.id, row]));
  const byId = new Map(input.transactions.map((txn) => [txn.id, txn]));
  return {
    at: new Date().toISOString(),
    label: input.label,
    itemIds: [...new Set(input.items.map((item) => item.id))],
    priorReviews: input.items.map((item) => stored.get(item.id) ?? { ...item, state: "OPEN" as const }),
    verdicts: [...new Set(input.verdictKeys)].map((key) => ({
      key,
      prior: input.verdicts?.[key] ?? null,
    })),
    movements: [...new Set(input.movementIds)].flatMap((id) => {
      const txn = byId.get(id);
      return txn ? [snapshotMovement(txn)] : [];
    }),
    ruleKeys: [...new Set(input.ruleKeys ?? [])],
  };
}

export function applyReviewUndoParts(
  action: ReviewUndoAction,
  input: {
    review?: ReviewItem[];
    verdicts?: Verdicts;
    rules?: Rules;
    transactions: InterpretedTransaction[];
  },
): {
  review?: ReviewItem[];
  verdicts?: Verdicts;
  rules?: Rules;
  transactions: InterpretedTransaction[];
} {
  const ids = new Set(action.itemIds);
  const kept = (input.review ?? []).filter((row) => !ids.has(row.id));
  const restore = action.priorReviews.filter(shouldStoreReview);
  const review = [...kept, ...restore];
  const snaps = new Map(action.movements.map((row) => [row.id, row]));
  return {
    review: review.length > 0 ? review : undefined,
    verdicts: restoreVerdicts(input.verdicts, action.verdicts),
    rules: forgetKeys(input.rules, action.ruleKeys),
    transactions: input.transactions.map((txn) => {
      const snap = snaps.get(txn.id);
      return snap ? restoreMovement(txn, snap) : txn;
    }),
  };
}

export function parseReviewUndo(value: unknown): ReviewUndoAction[] {
  if (!Array.isArray(value)) return [];
  const actions: ReviewUndoAction[] = [];
  for (const raw of value) {
    const parsed = parseUndoAction(raw);
    if (parsed) actions.push(parsed);
  }
  return actions.slice(-REVIEW_UNDO_LIMIT);
}

export function shouldStoreReview(item: ReviewItem): boolean {
  if (item.state !== "OPEN") return true;
  return (
    (item.declinedCreditIds?.length ?? 0) > 0 ||
    (item.declinedDebitIds?.length ?? 0) > 0 ||
    Boolean(item.deferredAt)
  );
}

function snapshotMovement(txn: InterpretedTransaction): ReviewUndoMovement {
  return {
    id: txn.id,
    type: txn.type,
    categoryKey: txn.categoryKey,
    ...(txn.decidedBy ? { decidedBy: txn.decidedBy } : {}),
    ...(txn.transferPair ? { transferPair: txn.transferPair } : {}),
    ...(txn.refundPair ? { refundPair: txn.refundPair } : {}),
    ...(txn.tags && txn.tags.length > 0 ? { tags: [...txn.tags] } : {}),
  };
}

function restoreMovement(txn: InterpretedTransaction, snap: ReviewUndoMovement): InterpretedTransaction {
  const next: InterpretedTransaction = {
    ...txn,
    type: snap.type,
    categoryKey: snap.categoryKey,
  };
  if (snap.decidedBy) next.decidedBy = snap.decidedBy;
  else delete next.decidedBy;
  if (snap.transferPair) next.transferPair = snap.transferPair;
  else delete next.transferPair;
  if (snap.refundPair) next.refundPair = snap.refundPair;
  else delete next.refundPair;
  if (snap.tags && snap.tags.length > 0) next.tags = snap.tags;
  else delete next.tags;
  delete next.verdict;
  return next;
}

function restoreVerdicts(held: Verdicts | undefined, changes: ReviewUndoVerdict[]): Verdicts | undefined {
  const next = { ...(held ?? {}) };
  for (const row of changes) {
    if (row.prior) next[row.key] = row.prior;
    else delete next[row.key];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function forgetKeys(rules: Rules | undefined, keys: string[]): Rules | undefined {
  if (!rules || keys.length === 0) return rules;
  let next = rules;
  for (const key of keys) next = forget(next, key);
  return Object.keys(next).length > 0 ? next : undefined;
}

function parseUndoAction(raw: unknown): ReviewUndoAction | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const held = raw as Partial<ReviewUndoAction>;
  if (typeof held.at !== "string" || typeof held.label !== "string") return undefined;
  if (!Array.isArray(held.itemIds) || !held.itemIds.every((id) => typeof id === "string")) return undefined;
  return {
    at: held.at,
    label: held.label,
    itemIds: held.itemIds,
    priorReviews: parseReviewItems(held.priorReviews),
    verdicts: parseUndoVerdicts(held.verdicts),
    movements: parseUndoMovements(held.movements),
    ruleKeys: Array.isArray(held.ruleKeys)
      ? held.ruleKeys.filter((key): key is string => typeof key === "string")
      : [],
  };
}

function parseUndoVerdicts(value: unknown): ReviewUndoVerdict[] {
  if (!Array.isArray(value)) return [];
  const rows: ReviewUndoVerdict[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const held = raw as { key?: unknown; prior?: unknown };
    if (typeof held.key !== "string" || !held.key) continue;
    if (held.prior == null) {
      rows.push({ key: held.key, prior: null });
      continue;
    }
    if (!held.prior || typeof held.prior !== "object") continue;
    const stored = held.prior as Partial<Verdict>;
    if (typeof stored.because !== "string" || typeof stored.at !== "string") continue;
    const known = verdictFor(stored.because, stored.at);
    if (known.because !== stored.because) continue;
    rows.push({ key: held.key, prior: known });
  }
  return rows;
}

function parseUndoMovements(value: unknown): ReviewUndoMovement[] {
  if (!Array.isArray(value)) return [];
  const rows: ReviewUndoMovement[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const held = raw as Partial<ReviewUndoMovement>;
    if (typeof held.id !== "string" || !held.id) continue;
    if (typeof held.categoryKey !== "string") continue;
    if (!isTransactionType(held.type)) continue;
    rows.push({
      id: held.id,
      type: held.type,
      categoryKey: held.categoryKey,
      ...(typeof held.decidedBy === "string" ? { decidedBy: held.decidedBy as DecidedBy } : {}),
      ...(typeof held.transferPair === "string" ? { transferPair: held.transferPair } : {}),
      ...(typeof held.refundPair === "string" ? { refundPair: held.refundPair } : {}),
      ...(Array.isArray(held.tags) && held.tags.every((tag) => typeof tag === "string")
        ? { tags: held.tags }
        : {}),
    });
  }
  return rows;
}
