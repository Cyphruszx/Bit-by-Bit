/**
 * Dev-mode Transactions table: the raw-ledger column set.
 *
 * Core (Spec 5 day-one) stays Date / Merchant / Amount / Account? / Type /
 * Group / Category / Tag. This preset is only for an explicit Dev mode toggle.
 */

import { isUserOverridden, kindOf } from "@/lib/money-flow/movement-kind";
import type { ReviewItem } from "@/lib/money-flow/review-queue";
import { sourcePairs } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import type { LedgerRowMeta } from "@/lib/money-flow/ledger";

export const DEV_TABLE_ID = "dev" as const;
export const DEV_TABLE_LABEL = "Dev mode (raw ledger)";

/** Fixed columns before bank.* / source.* / tags / rq_* / ids. */
export const DEV_TABLE_BEFORE_BANK = [
  "dateIso",
  "direction/amount",
  "baseAmount",
  "movement_kind",
  "status",
  "merchant",
  "description",
  "categoryKey",
  "accountId",
  "institution",
  "fingerprint",
  "transferPair",
  "refundPair",
  "duplicate_of_id",
  "decidedBy",
  "user_overridden",
  "confidence",
  "extractedBy",
  "sourceFile",
] as const;

export const DEV_TABLE_BANK = ["bank.category", "bank.type", "bank.merchant"] as const;

export const DEV_TABLE_AFTER_SOURCE = [
  "tags",
  "rq_reason",
  "rq_state",
  "rq_id",
  "id",
  "importIds",
  "firstSeen",
  "accountKey",
  "verdict",
  "userFlaggedSavings",
] as const;

export const EMPTY_CELL = "—";

export type DevTableContext = {
  meta?: LedgerRowMeta;
  review?: ReviewItem[];
};

export function sourceColumnKeys(transactions: InterpretedTransaction[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const txn of transactions) {
    for (const pair of sourcePairs(txn.source)) {
      const key = `source.${pair.header}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export function devTableColumns(transactions: InterpretedTransaction[] = []): string[] {
  return [...DEV_TABLE_BEFORE_BANK, ...DEV_TABLE_BANK, ...sourceColumnKeys(transactions), ...DEV_TABLE_AFTER_SOURCE];
}

export function blankCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return EMPTY_CELL;
  if (typeof value === "string" && value.trim() === "") return EMPTY_CELL;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : EMPTY_CELL;
  return value;
}

export function directionAmount(amount: number): string {
  const direction = amount > 0 ? "IN" : amount < 0 ? "OUT" : "FLAT";
  return `${direction} ${amount}`;
}

function reviewFor(txnId: string, review: ReviewItem[] | undefined): ReviewItem[] {
  if (!review || review.length === 0) return [];
  return review.filter((item) => item.movementIds.includes(txnId));
}

export function devTableCell(txn: InterpretedTransaction, key: string, ctx: DevTableContext = {}): string {
  const items = reviewFor(txn.id, ctx.review);
  if (key.startsWith("source.")) {
    const header = key.slice("source.".length);
    const pair = sourcePairs(txn.source).find((cell) => cell.header === header);
    return blankCell(pair?.value);
  }

  switch (key) {
    case "dateIso":
      return blankCell(txn.dateIso);
    case "direction/amount":
      return directionAmount(txn.amount);
    case "baseAmount":
      return blankCell(txn.baseAmount ?? txn.amount);
    case "movement_kind":
      return kindOf(txn.type);
    case "status":
      return blankCell(txn.status ?? "CLEARED");
    case "merchant":
      return blankCell(txn.merchant);
    case "description":
      return blankCell(txn.description);
    case "categoryKey":
      return blankCell(txn.categoryKey);
    case "accountId":
      return blankCell(txn.accountId);
    case "institution":
      return blankCell(txn.institution);
    case "fingerprint":
      return blankCell(ctx.meta?.fingerprint);
    case "transferPair":
      return blankCell(txn.transferPair);
    case "refundPair":
      return blankCell(txn.refundPair);
    case "duplicate_of_id":
      return EMPTY_CELL;
    case "decidedBy":
      return blankCell(txn.decidedBy);
    case "user_overridden":
      return blankCell(isUserOverridden(txn));
    case "confidence":
      return blankCell(txn.confidence);
    case "extractedBy":
      return blankCell(txn.extractedBy);
    case "sourceFile":
      return blankCell(txn.sourceFile);
    case "bank.category":
      return blankCell(txn.bank?.category);
    case "bank.type":
      return blankCell(txn.bank?.type);
    case "bank.merchant":
      return blankCell(txn.bank?.merchant);
    case "tags":
      return blankCell((txn.tags ?? []).join(", "));
    case "rq_reason":
      return blankCell(items.map((item) => item.reason).join(", "));
    case "rq_state":
      return blankCell(items.map((item) => item.state).join(", "));
    case "rq_id":
      return blankCell(items.map((item) => item.id).join(", "));
    case "id":
      return blankCell(txn.id);
    case "importIds":
      return blankCell(ctx.meta?.importIds.join(", "));
    case "firstSeen":
      return blankCell(ctx.meta?.firstSeen);
    case "accountKey":
      return blankCell(txn.accountKey);
    case "verdict":
      return blankCell(txn.verdict?.because);
    case "userFlaggedSavings":
      return txn.userFlaggedSavings === undefined ? EMPTY_CELL : blankCell(txn.userFlaggedSavings);
    default:
      return EMPTY_CELL;
  }
}
