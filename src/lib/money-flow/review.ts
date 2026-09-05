/**
 * The movements nothing could place, gathered into as few questions as possible.
 *
 * A year of statements lands at once and several hundred of them will be merchants no rule
 * knows. Asked one at a time that is an afternoon; asked by merchant it is a couple of
 * minutes, because the long tail is the same shop over and over.
 *
 * Ordered by how much money is behind each question rather than by how many movements, so
 * the first answer is always the one that moves the reports most. On the sample statements
 * that puts a $24,800 payment above forty coffees.
 */

import { tidyMerchant } from "@/lib/money-flow/categorize";
import { needsReview } from "@/lib/money-flow/classify";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { merchantKey } from "@/lib/money-flow/redact";
import { countedMovements } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type ReviewGroup = {
  /**
   * The merchant, normalised and tidied. Not as any one row wrote it: a group of ten rows
   * stamped with ten different reference numbers would otherwise be labelled with one of
   * them, which reads as a single payment rather than as the payee it stands for.
   */
  merchant: string;
  /** One of them, so the row can be rendered and edited like any other. */
  example: InterpretedTransaction;
  count: number;
  /** Signed, so the queue can say whether this is money in or money out. */
  amount: number;
  from: string;
  to: string;
};

/**
 * Only what a total actually counts. A movement already settled as a transfer or a
 * reversal is not in any figure, so asking what it was for would be asking a person to
 * tidy something nothing is reading.
 */
export function unsortedMovements(transactions: InterpretedTransaction[]): InterpretedTransaction[] {
  return countedMovements(transactions).filter(needsReview);
}

export function reviewGroups(transactions: InterpretedTransaction[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();

  for (const txn of unsortedMovements(transactions)) {
    const key = merchantKey(txn);
    const held = groups.get(key);
    groups.set(key, {
      merchant: held?.merchant ?? tidyMerchant(key),
      example: held?.example ?? txn,
      count: (held?.count ?? 0) + 1,
      amount: roundMoney((held?.amount ?? 0) + txn.amount),
      from: held && held.from < txn.dateIso ? held.from : txn.dateIso,
      to: held && held.to > txn.dateIso ? held.to : txn.dateIso,
    });
  }

  return [...groups.values()].sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.merchant.localeCompare(b.merchant),
  );
}

export type ReviewProgress = {
  sorted: number;
  total: number;
  /** Whole percent, so a bar and a sentence agree with each other. */
  percent: number;
  /** Money sitting behind the unanswered questions. */
  unsorted: number;
};

/**
 * How far through the person is.
 *
 * Shown as what is done rather than what is left, because a first import is mostly
 * unsorted and a screen that opens on "412 to go" reads as a bill. It is also the honest
 * number: the rules place most of a statement without being asked.
 */
export function reviewProgress(transactions: InterpretedTransaction[]): ReviewProgress {
  const counted = countedMovements(transactions);
  const waiting = counted.filter(needsReview);
  const total = counted.length;
  const sorted = total - waiting.length;
  return {
    sorted,
    total,
    percent: total === 0 ? 100 : Math.round((sorted / total) * 100),
    unsorted: roundMoney(waiting.reduce((sum, txn) => sum + Math.abs(txn.amount), 0)),
  };
}
