/**
 * What the money-in figure is actually made of.
 *
 * A single number cannot be argued with. $142,796.02 of income looks wrong to a person
 * who knows what they earn, and until they can see that $120,844.20 of it is a practice's
 * Medicare billing already filed under Income, they have no way to say which part is
 * wrong. Splitting the figure turns a wrong total into a specific question.
 *
 * Nothing here changes a total. It only says where one came from.
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { needsReview } from "@/lib/money-flow/classify";
import { displayName } from "@/lib/money-flow/display-name";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { looksInternal, looksReturned } from "@/lib/money-flow/statement-category";
import { countedMovements, isEarnings } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { likeKey } from "@/lib/money-flow/verdicts";

export type IncomeSourceKind = "earned" | "returned" | "arrived";

export type IncomeSource = {
  kind: IncomeSourceKind;
  label: string;
  /** Why this money is in the figure, and what would take it out. */
  detail: string;
  amount: number;
  count: number;
  /**
   * Whether a person could settle this themselves. Earnings need no verdict; a credit
   * that arrived from nowhere is exactly what only they can explain.
   */
  askable: boolean;
};

/**
 * Income split by how sure the reader is about it, surest first.
 *
 * Only movements the totals actually counted are included, so a refund that cancelled its
 * payment and a transfer whose other leg was found are both absent — they are not income
 * and they are not in the figure this explains.
 */
export function incomeSources(transactions: InterpretedTransaction[]): IncomeSource[] {
  // Only what the money-in figure actually holds. A drawdown the reader has already typed
  // as borrowing is not in that figure, so listing it here would explain a number nobody
  // is being shown — and would leave the card and the headline disagreeing.
  const credits = countedMovements(transactions).filter(isEarnings);

  // A person who has said "this is money I earned" has settled it, whatever the bank
  // called it, so it stops being asked about.
  const confirmed = credits.filter((txn) => txn.verdict?.counts === true);
  const open = credits.filter((txn) => !txn.verdict);
  // Split on what the *bank* claimed, and only where the ledger has not already
  // answered. Medicare under "Refund" used to be the whole of this card; the
  // rules now file it as income, so asking again is asking a person to confirm
  // a category the ledger already wrote. What remains is a credit with no
  // category and no matching payment — the bank's label is the only hint left.
  const returned = open.filter((txn) => looksReturned(txn) && needsReview(txn));
  const arrived = open.filter((txn) => !looksReturned(txn) && looksInternal(txn) && needsReview(txn));
  const claimed = new Set([...returned, ...arrived].map((txn) => txn.id));
  const earned = [...confirmed, ...open.filter((txn) => !claimed.has(txn.id))];

  const sources: IncomeSource[] = [
    {
      kind: "earned",
      label: "Earned",
      detail: "Wages, interest and payments from other people",
      amount: total(earned),
      count: earned.length,
      askable: false,
    },
    {
      kind: "returned",
      label: "Called a refund by the bank",
      detail:
        "The bank called these a refund, they still have no category, and no payment in " +
        "the ledger reverses them. Benefits the rules already filed sit under Earned.",
      amount: total(returned),
      count: returned.length,
      askable: true,
    },
    {
      kind: "arrived",
      label: "Arrived from somewhere else",
      detail:
        "The bank called these a transfer, they still have no category, and no matching " +
        "payment left an account you have added. Usually an account not uploaded yet.",
      amount: total(arrived),
      count: arrived.length,
      askable: true,
    },
  ];

  return sources.filter((source) => source.count > 0);
}

/** The part of the money-in figure a person could still explain away. */
export function unsettledIncome(transactions: InterpretedTransaction[]): number {
  return roundMoney(
    incomeSources(transactions)
      .filter((source) => source.askable)
      .reduce((sum, source) => sum + source.amount, 0),
  );
}

function total(rows: InterpretedTransaction[]): number {
  return roundMoney(rows.reduce((sum, txn) => sum + txn.amount, 0));
}

export type UnsettledGroup = {
  /** The key a verdict would be recorded under, covering every movement in the group. */
  key: string;
  /** One of them, to read the wording and the account off. */
  example: InterpretedTransaction;
  label: string;
  account: string;
  count: number;
  amount: number;
  kind: IncomeSourceKind;
  /** The stretch these movements cover, so a run can be recognised by when it happened. */
  from: string;
  to: string;
};

/**
 * Money in the ledger could not settle, gathered by wording so a run is one question
 * rather than a hundred. Biggest first. Credits the rules already filed — Medicare,
 * ATO, a lender's drawdown — are not here; Needs a category is for shops, and this
 * list is only unsorted refunds and transfers still sitting in money in.
 */
export function unsettledGroups(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): UnsettledGroup[] {
  const open = countedMovements(transactions).filter(
    (txn) =>
      isEarnings(txn) &&
      !txn.verdict &&
      needsReview(txn) &&
      (looksReturned(txn) || looksInternal(txn)),
  );

  const grouped = new Map<string, UnsettledGroup>();
  for (const txn of open) {
    const key = likeKey(txn, registry);
    const held = grouped.get(key);
    grouped.set(key, {
      key,
      example: held?.example ?? txn,
      label: held?.label ?? displayName(txn),
      account: held?.account ?? accountIdOf(txn, registry),
      count: (held?.count ?? 0) + 1,
      amount: roundMoney((held?.amount ?? 0) + txn.amount),
      // Held like every other field: one wording carrying both a refund and a transfer row
      // should not change its caption depending on which came last in the array.
      kind: held?.kind ?? (looksReturned(txn) ? "returned" : "arrived"),
      from: held && held.from < txn.dateIso ? held.from : txn.dateIso,
      to: held && held.to > txn.dateIso ? held.to : txn.dateIso,
    });
  }

  return [...grouped.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}
