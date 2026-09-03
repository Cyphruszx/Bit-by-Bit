/**
 * What the money-in figure is actually made of.
 *
 * A single number cannot be argued with. $167,796.02 of income looks wrong to a person
 * who knows what they earn, and until they can see that $120,844.20 of it is a practice's
 * Medicare billing and $25,000 is a loan drawdown, they have no way to say which part is
 * wrong. Splitting the figure turns a wrong total into a specific question.
 *
 * Nothing here changes a total. It only says where one came from.
 */

import { roundMoney } from "@/lib/money-flow/parse-values";
import { countedMovements } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

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
  const credits = countedMovements(transactions).filter((txn) => txn.amount > 0);

  const earned = credits.filter((txn) => txn.type === "income");
  const returned = credits.filter((txn) => txn.type === "refund");
  const arrived = credits.filter((txn) => txn.type === "transfer");
  // Anything the reader could not type at all is money the person earned as far as the
  // totals are concerned, so it is counted with earnings rather than quietly dropped.
  const rest = credits.filter((txn) => !["income", "refund", "transfer"].includes(txn.type));

  const sources: IncomeSource[] = [
    {
      kind: "earned",
      label: "Earned",
      detail: "Wages, interest and payments from other people",
      amount: total([...earned, ...rest]),
      count: earned.length + rest.length,
      askable: false,
    },
    {
      kind: "returned",
      label: "Called a refund by the bank",
      detail:
        "No payment in your statements matches these, so they are counted as money in. " +
        "A benefit or a rebate paid to you belongs here; a refund whose purchase you have " +
        "not uploaded does not.",
      amount: total(returned),
      count: returned.length,
      askable: true,
    },
    {
      kind: "arrived",
      label: "Arrived from somewhere else",
      detail:
        "Money the bank called a transfer, with no matching payment out of an account you " +
        "have added. Usually an account you have not uploaded, or borrowed money.",
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
