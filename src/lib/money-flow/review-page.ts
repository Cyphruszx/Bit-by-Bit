/**
 * Spec 7 Review page helpers: Open / History surfaces, reason_code chips,
 * account + last-30-days filters, and the nav badge (OPEN only).
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { calendarDate } from "@/lib/money-flow/period";
import { merchantKey } from "@/lib/money-flow/redact";
import {
  isReviewDeferred,
  openReviewCount,
  transferPartnersFor,
  type ReviewItem,
  type ReviewReason,
} from "@/lib/money-flow/review-queue";
import { tagsOf, withCategory, withTags } from "@/lib/money-flow/tags";
import type { MatchOptions } from "@/lib/money-flow/transfers";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import type { VerdictReason } from "@/lib/money-flow/verdicts";

export type ReviewOpenActionId =
  | "confirm"
  | "confirm-as-transfer"
  | "confirm-as-loan"
  | "confirm-refund"
  | "mark-income"
  | "keep-as-money"
  | "assign-category"
  | "skip"
  | "undefer"
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
  partnerCount?: number;
  paymentCount?: number;
  selectedPartnerId?: string;
  selectedPaymentId?: string;
  selectedCategoryKey?: string;
  keepAsLabel?: string;
  deferred?: boolean;
  isCredit?: boolean;
};

/**
 * Spec 7 / Wonder action matrix. Every OPEN reason has an enabled path that is
 * not a lone Not that. Not that only appears when there is a pairing to decline.
 */
export function reviewOpenActions(item: ReviewItem, ctx: ReviewOpenActionContext): ReviewOpenAction[] {
  const partnerCount = ctx.partnerCount ?? 0;
  const paymentCount = ctx.paymentCount ?? 0;
  const deferred = ctx.deferred ?? isReviewDeferred(item);
  const isCredit = ctx.isCredit ?? reviewItemIsCredit(item);
  let actions: ReviewOpenAction[];
  switch (item.reason) {
    case "UNPAIRED_TRANSFER":
      if (partnerCount > 0) {
        const hasPick = Boolean(ctx.selectedPartnerId);
        actions = [
          { id: "confirm", label: "Confirm", role: "primary", enabled: hasPick },
          { id: "not-that", label: "Not that", role: "secondary", enabled: hasPick },
        ];
        break;
      }
      actions = [
        { id: "confirm-as-transfer", label: "Confirm as transfer", role: "primary", enabled: true },
        ...(isCredit
          ? [{ id: "confirm-as-loan" as const, label: "Confirm as loan", role: "primary" as const, enabled: true }]
          : []),
        {
          id: "keep-as-money",
          label: ctx.keepAsLabel ?? "Keep as spending",
          role: "secondary",
          enabled: true,
        },
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
      break;
    case "PARTIAL_REFUND":
    case "FULL_REFUND_AMBIGUOUS": {
      const paymentReady = Boolean(ctx.selectedPaymentId) || paymentCount === 0;
      actions = [
        { id: "confirm-refund", label: "Confirm refund", role: "primary", enabled: paymentReady },
        { id: "mark-income", label: "Mark as income", role: "secondary", enabled: true },
      ];
      if (paymentCount > 1 && ctx.selectedPaymentId) {
        actions.push({ id: "not-that", label: "Not that", role: "secondary", enabled: true });
      }
      break;
    }
    case "UNREVIEWED_KIND":
      actions = [
        {
          id: "assign-category",
          label: "Assign category",
          role: "primary",
          enabled: Boolean(ctx.selectedCategoryKey),
        },
        ...(isCredit
          ? [{ id: "confirm-as-loan" as const, label: "Confirm as loan", role: "primary" as const, enabled: true }]
          : []),
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
      break;
    case "INGEST_PARSE":
      actions = [{ id: "dismiss", label: "Dismiss", role: "primary", enabled: true }];
      break;
    default:
      actions = [
        { id: "keep-filing", label: "Keep this filing", role: "primary", enabled: true },
        { id: "skip", label: "Skip for now", role: "secondary", enabled: true },
      ];
  }
  if (deferred) {
    actions = actions.filter((action) => action.id !== "skip");
    actions.push({ id: "undefer", label: "Back to Open", role: "secondary", enabled: true });
  }
  return actions;
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

export function reviewMovementOf(
  item: ReviewItem,
  byId: Map<string, InterpretedTransaction>,
): InterpretedTransaction | undefined {
  const id = item.debitId ?? item.creditId ?? item.movementIds[0];
  return id ? byId.get(id) : undefined;
}

/**
 * Same-account counterparty key for Apply to similar. Trailing bank/ref tokens
 * (`S554…`, `H019…`, `HO019…`, `T5`) are stripped so person-name prefixes match.
 */
export function unpairedSimilarityKey(
  item: ReviewItem,
  byId: Map<string, InterpretedTransaction>,
  registry: AccountRegistry = {},
): string {
  const txn = reviewMovementOf(item, byId);
  if (!txn) return "";
  const payee = similarCounterpartyKey(txn.merchant);
  if (!payee) return "";
  return `${accountIdOf(txn, registry)}|${payee}`;
}

/** Strip trailing alphanumeric ref codes / digit-letter tails after a name prefix. */
export function similarCounterpartyKey(merchant: string): string {
  const tokens = merchant.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && isTrailingBankRef(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return merchantKey({ merchant: tokens.join(" ") });
}

function isTrailingBankRef(token: string): boolean {
  return /\d/.test(token);
}

export function unpairedAsTransferReason(amount: number): VerdictReason {
  return amount < 0 ? "not-mine" : "own-account";
}

export function unpairedKeepReason(amount: number): VerdictReason {
  return amount < 0 ? "spent" : "earned";
}

export function unpairedLoanReason(): VerdictReason {
  return "borrowed";
}

export function reviewItemIsCredit(
  item: ReviewItem,
  byId: Map<string, InterpretedTransaction> = new Map(),
): boolean {
  if (item.reason === "UNREVIEWED_KIND" && byId.size > 0) {
    const rows = item.movementIds
      .map((id) => byId.get(id))
      .filter((txn): txn is InterpretedTransaction => Boolean(txn));
    return rows.length > 0 && rows.every((txn) => txn.amount > 0);
  }
  const txn = reviewMovementOf(item, byId);
  if (txn) return txn.amount > 0;
  return Boolean(item.creditId) && !item.debitId;
}

/** Spec 3 DEBT_PRINCIPAL drawdown: existing debt-payments category + Drawdown tag. */
export function fileAsLoanDrawdown(txn: InterpretedTransaction): InterpretedTransaction {
  return withTags(withCategory(txn, "debt-payments"), [...tagsOf(txn), "Drawdown"]);
}

/** OPEN no-partner UNPAIRED_TRANSFER items that share the current card's payee key. */
export function similarOpenUnpaired(
  item: ReviewItem,
  items: ReviewItem[],
  transactions: InterpretedTransaction[],
  options?: MatchOptions,
  registry: AccountRegistry = {},
): ReviewItem[] {
  if (item.reason !== "UNPAIRED_TRANSFER") return [item];
  if (isReviewDeferred(item)) return [item];
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  const key = unpairedSimilarityKey(item, byId, registry);
  if (!key) return [item];
  const seed = reviewMovementOf(item, byId);
  return items.filter((row) => {
    if (row.state !== "OPEN" || row.reason !== "UNPAIRED_TRANSFER") return false;
    if (isReviewDeferred(row)) return false;
    if (unpairedSimilarityKey(row, byId, registry) !== key) return false;
    const other = reviewMovementOf(row, byId);
    if (seed && other && Math.sign(seed.amount) !== Math.sign(other.amount)) return false;
    return transferPartnersFor(row, transactions, options).length === 0;
  });
}

export type SimilarMovementPreview = {
  id: string;
  dateIso: string;
  amount: number;
  line: string;
};

export function similarMovementPreviews(
  similar: ReviewItem[],
  transactions: InterpretedTransaction[],
): SimilarMovementPreview[] {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  return similar.flatMap((row) => {
    const txn = reviewMovementOf(row, byId);
    if (!txn) return [];
    return [{ id: row.id, dateIso: txn.dateIso, amount: txn.amount, line: reviewStatementLine(txn) }];
  });
}

export function reviewStatementLine(txn: InterpretedTransaction): string {
  return txn.description?.trim() || txn.merchant;
}

export type ReviewMovementFact = {
  id: string;
  role: "out" | "in" | "movement";
  amount: number;
  dateIso: string;
  account: string;
  merchant: string;
  line: string;
};

export function reviewMovementFacts(
  item: ReviewItem,
  byId: Map<string, InterpretedTransaction>,
  accountLabel: (id: string) => string,
): ReviewMovementFact[] {
  const facts: ReviewMovementFact[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined, role: ReviewMovementFact["role"]) => {
    if (!id || seen.has(id)) return;
    const txn = byId.get(id);
    if (!txn) return;
    seen.add(id);
    facts.push({
      id,
      role,
      amount: txn.amount,
      dateIso: txn.dateIso,
      account: accountLabel(id),
      merchant: txn.merchant,
      line: reviewStatementLine(txn),
    });
  };

  if (item.reason === "UNPAIRED_TRANSFER") {
    push(item.debitId, "out");
    push(item.creditId, "in");
    if (facts.length > 0) return facts;
  }
  if (item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") {
    push(item.creditId, "in");
    push(item.debitId, "out");
    if (facts.length > 0) return facts;
  }
  for (const id of item.movementIds) {
    push(id, "movement");
    if (facts.length >= 4) break;
  }
  return facts;
}

export function unpairedSettleTargets(
  item: ReviewItem,
  items: ReviewItem[],
  transactions: InterpretedTransaction[],
  applySimilar: boolean,
  options?: MatchOptions,
  registry: AccountRegistry = {},
): ReviewItem[] {
  if (!applySimilar) return [item];
  const similar = similarOpenUnpaired(item, items, transactions, options, registry);
  return similar.length > 0 ? similar : [item];
}

export type ReviewSurface = "open" | "history";

export type ReviewReasonFilter = "all" | "unpaired" | "refund" | "needs_category" | "skipped";

export const REVIEW_REASON_FILTERS: { id: ReviewReasonFilter; label: string; reasons?: ReviewReason[] }[] = [
  { id: "all", label: "All" },
  { id: "unpaired", label: "Unpaired", reasons: ["UNPAIRED_TRANSFER"] },
  { id: "refund", label: "Refund", reasons: ["PARTIAL_REFUND", "FULL_REFUND_AMBIGUOUS"] },
  { id: "needs_category", label: "Needs category", reasons: ["UNREVIEWED_KIND"] },
  { id: "skipped", label: "Skipped" },
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

export const REVIEW_PAGE_SIZE = 5;

export type ReviewPageWindow<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
};

export function pageReviewItems<T>(
  items: T[],
  page: number,
  size = REVIEW_PAGE_SIZE,
): ReviewPageWindow<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size) || 1);
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = total === 0 ? 0 : safePage * size;
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    page: safePage,
    pageCount: total === 0 ? 1 : pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

export function skippedOpenCount(items: ReviewItem[]): number {
  return items.filter(isReviewDeferred).length;
}

export function filterReviewItems(
  items: ReviewItem[],
  filter: ReviewPageFilter,
  transactions: InterpretedTransaction[] = [],
  registry: AccountRegistry = {},
): ReviewItem[] {
  const skippedOnly = filter.reason === "skipped";
  const reasons = skippedOnly ? undefined : REVIEW_REASON_FILTERS.find((row) => row.id === filter.reason)?.reasons;
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  return items.filter((item) => {
    if (filter.surface === "open" && item.state !== "OPEN") return false;
    if (filter.surface === "history" && item.state === "OPEN") return false;
    if (filter.surface === "open") {
      if (skippedOnly && !isReviewDeferred(item)) return false;
      if (!skippedOnly && isReviewDeferred(item)) return false;
    }
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
