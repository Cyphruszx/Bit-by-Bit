/**
 * Spec 7: Core never auto-resolves money-trust — except Spec 3/7 unique
 * same-institution pairs, which resolve silently (no OPEN item).
 *
 * Cross-institution / contested / orphan / unknown-institution stays OPEN.
 * Refunds still need Review Queue confirm. Spec 12.5 keeps CLEARED Open Banking
 * same-institution pairs through `forgetAutoPairs`.
 */

import { outranks } from "@/lib/money-flow/classify";
import { institutionOf, UNKNOWN_INSTITUTION, type InstitutionOverrides } from "@/lib/money-flow/institution";
import { isTransferKind, isUserOverridden } from "@/lib/money-flow/movement-kind";
import { matchRefunds, type RefundOptions } from "@/lib/money-flow/refunds";
import { typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import { isCleared } from "@/lib/money-flow/tile";
import { matchTransfers, type MatchOptions, type TransferPair } from "@/lib/money-flow/transfers";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * Drops auto-written pair marks so a ledger stored before Slice 2 cannot keep
 * silently cancelling totals. Spec 7 RESOLVE (`user_overridden` / `said`) is kept.
 * Spec 12.5: a silent same-institution Open Banking pair survives when both
 * legs are CLEARED and the institution is known (Unknown ≠ Unknown).
 */
export function forgetAutoPairs(transactions: InterpretedTransaction[]): InterpretedTransaction[] {
  const silent = silentOpenBankingPairIds(transactions);
  return transactions.map((txn) => {
    if (txn.decidedBy === "said" || txn.decidedBy === "user_overridden") return txn;
    if (silent.has(txn.id)) return txn;
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
  const openPairs = transfers.pairs.filter(
    (pair) => !isSilentSameInstitutionUniquePair(pair, options.institutions),
  );
  const n = openPairs.length;
  const m = refunds.pairs.length;
  const contested = transfers.contested.length;
  if (n + m + contested === 0) return undefined;
  const bits: string[] = [];
  if (n) bits.push(`${n} likely transfer${n === 1 ? "" : "s"}`);
  if (m) bits.push(`${m} likely refund${m === 1 ? "" : "s"}`);
  if (contested) bits.push(`${contested} contested transfer${contested === 1 ? "" : "s"}`);
  return `Detected ${bits.join(", ")}. Held out of Income, Spending, Refund credits and Net until confirmed (Review Queue, Spec 7).`;
}

/**
 * Spec 3/7: unique same-institution pairs with a known bank resolve silently.
 * Unknown ≠ Unknown. Contested / cross-institution / one-sided stay for Review.
 */
export function applySilentSameInstitutionUniquePairs(
  transactions: InterpretedTransaction[],
  options: MatchOptions = {},
): InterpretedTransaction[] {
  const overrides = options.institutions ?? {};
  const match = matchTransfers(transactions, options);
  const pairOf = new Map<string, string>();
  for (const pair of match.pairs) {
    if (!isSilentSameInstitutionUniquePair(pair, overrides)) continue;
    const token = `${pair.debit.id}~${pair.credit.id}`;
    pairOf.set(pair.debit.id, token);
    pairOf.set(pair.credit.id, token);
  }
  if (pairOf.size === 0) return transactions;

  return transactions.map((txn) => {
    const token = pairOf.get(txn.id);
    if (!token || isUserOverridden(txn)) return txn;
    if (txn.transferPair === token && isTransferKind(txn.type)) return txn;
    return {
      ...txn,
      transferPair: token,
      type: "TRANSFER" as const,
      ...(outranks("paired", txn.decidedBy) ? { decidedBy: "paired" as const } : {}),
    };
  });
}

/** Known bank on both legs, and the same bank. Unknown never equals Unknown. */
export function isKnownSameInstitution(
  left: InterpretedTransaction,
  right: InterpretedTransaction,
  overrides: InstitutionOverrides = {},
): boolean {
  const a = institutionOf(left, overrides);
  const b = institutionOf(right, overrides);
  if (a === UNKNOWN_INSTITUTION || b === UNKNOWN_INSTITUTION) return false;
  return a === b;
}

/** Spec 3/7 unique pair: matcher already refused contested; both legs known same bank. */
export function isSilentSameInstitutionUniquePair(
  pair: TransferPair,
  overrides: InstitutionOverrides = {},
): boolean {
  return pair.sameInstitution && isKnownSameInstitution(pair.debit, pair.credit, overrides);
}

/**
 * Spec 12.5 silent pair: both legs CLEARED, same known institution, and at
 * least one Open Banking leg. Unknown ≠ Unknown. CSV-only auto-marks still drop.
 */
export function silentOpenBankingPairIds(
  transactions: InterpretedTransaction[],
  overrides: Parameters<typeof institutionOf>[1] = {},
): Set<string> {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  const keep = new Set<string>();
  for (const txn of transactions) {
    if (!txn.transferPair || keep.has(txn.id)) continue;
    const other = otherTransferLeg(txn, byId);
    if (!other) continue;
    if (!isSilentSameInstitutionPair(txn, other, overrides)) continue;
    keep.add(txn.id);
    keep.add(other.id);
  }
  return keep;
}

export function isSilentSameInstitutionPair(
  left: InterpretedTransaction,
  right: InterpretedTransaction,
  overrides: Parameters<typeof institutionOf>[1] = {},
): boolean {
  if (!isCleared(left) || !isCleared(right)) return false;
  if (left.ingestSource !== "OPEN_BANKING" && right.ingestSource !== "OPEN_BANKING") return false;
  return isKnownSameInstitution(left, right, overrides);
}

function otherTransferLeg(
  txn: InterpretedTransaction,
  byId: Map<string, InterpretedTransaction>,
): InterpretedTransaction | undefined {
  const pair = txn.transferPair;
  if (!pair) return undefined;
  const otherId = pair.split("~").find((id) => id && id !== txn.id);
  if (otherId && byId.get(otherId)) return byId.get(otherId);
  return [...byId.values()].find((row) => row.id !== txn.id && row.transferPair === pair);
}
