/**
 * What a movement was for.
 *
 * A movement has exactly one category. Nothing in here changes a figure except by
 * filing that movement under a different category, which is the one decision a person
 * is making.
 */

import { merchantKey } from "@/lib/money-flow/redact";
import { isCategoryKey, typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";

/** What the money was for. Always a taxonomy key, never a display name. */
export function categoryOf(txn: Pick<InterpretedTransaction, "categoryKey">): string {
  return isCategoryKey(txn.categoryKey) ? txn.categoryKey : UNCATEGORISED;
}

/**
 * A person choosing a category settles it, which is the highest rung on the ladder: no
 * later re-read, better rule or model call moves it again.
 */
export function withCategory(
  txn: InterpretedTransaction,
  categoryKey: string,
  decidedBy: DecidedBy = "user_overridden",
): InterpretedTransaction {
  const next = isCategoryKey(categoryKey) ? categoryKey : UNCATEGORISED;
  return { ...txn, categoryKey: next, type: typeForCategory(next, txn.amount), decidedBy };
}

/** Statements name a merchant inconsistently in case, so match on the tidied name. */
export function sameMerchant(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function merchantRows(
  transactions: InterpretedTransaction[],
  merchant: string,
): InterpretedTransaction[] {
  return transactions.filter((txn) => sameMerchant(txn.merchant, merchant));
}

/**
 * The same category on every movement of one merchant, leaving every other movement alone.
 *
 * Matched on the normalised name rather than the written one, so re-filing a payee the
 * bank stamps with a fresh reference number each time catches all of them — which is what
 * the person meant, and what the review queue promised when it asked once.
 */
export function categorizeMerchant(
  transactions: InterpretedTransaction[],
  merchant: string,
  categoryKey: string,
): InterpretedTransaction[] {
  const wanted = merchantKey({ merchant });
  return transactions.map((txn) => (merchantKey(txn) === wanted ? withCategory(txn, categoryKey) : txn));
}
