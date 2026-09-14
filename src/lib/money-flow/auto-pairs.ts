/**
 * Spec 7: Core never auto-resolves money-trust.
 *
 * `matchTransfers` / `matchRefunds` still detect candidates. Writing `transferPair` /
 * `refundPair` and `type: moved` / `returned` is ledger truth — that is Spec 7 RESOLVE,
 * not ingest. OPEN candidates are held out of Income / Spending / Refund credits / Net
 * until that write.
 */

import { matchRefunds, type RefundOptions } from "@/lib/money-flow/refunds";
import { typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import { matchTransfers, type MatchOptions } from "@/lib/money-flow/transfers";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * Drops auto-written pair marks so a ledger stored before Slice 2 cannot keep
 * silently cancelling totals. Spec 7 RESOLVE (`user_overridden` / `said`) is kept.
 */
export function forgetAutoPairs(transactions: InterpretedTransaction[]): InterpretedTransaction[] {
  return transactions.map((txn) => {
    if (txn.decidedBy === "said" || txn.decidedBy === "user_overridden") return txn;
    const auto = txn.decidedBy === "paired" || Boolean(txn.transferPair) || Boolean(txn.refundPair);
    if (!auto) return txn;
    const next: InterpretedTransaction = {
      ...txn,
      type: typeForCategory(txn.categoryKey, txn.amount),
      decidedBy:
        txn.decidedBy === "paired"
          ? txn.categoryKey === UNCATEGORISED
            ? "unreviewed"
            : "rules"
          : txn.decidedBy,
    };
    delete next.transferPair;
    delete next.refundPair;
    return next;
  });
}

/** Candidates were found; tiles hold them out until the Review Queue confirms. */
export function pendingPairInsight(
  transactions: InterpretedTransaction[],
  options: MatchOptions & RefundOptions = {},
): string | undefined {
  const transfers = matchTransfers(transactions, options);
  const refunds = matchRefunds(transactions, options);
  const n = transfers.pairs.length;
  const m = refunds.pairs.length;
  const contested = transfers.contested.length;
  if (n + m + contested === 0) return undefined;
  const bits: string[] = [];
  if (n) bits.push(`${n} likely transfer${n === 1 ? "" : "s"}`);
  if (m) bits.push(`${m} likely refund${m === 1 ? "" : "s"}`);
  if (contested) bits.push(`${contested} contested transfer${contested === 1 ? "" : "s"}`);
  return `Detected ${bits.join(", ")}. Held out of Income, Spending, Refund credits and Net until confirmed (Review Queue, Spec 7).`;
}
