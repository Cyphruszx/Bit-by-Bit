/**
 * Spec 10 tile helpers.
 *
 * Tiles are Σ `base_amount` of CLEARED rows. Core AUD commits `base_amount = amount`.
 * Rows stored before those fields existed are treated as CLEARED with
 * `base_amount = amount`.
 *
 * HOLD exists so CLEARED-only filtering can be proven. It is not Spec 7 Review
 * Queue: no reason codes, no-dismiss, or badge.
 */

import type { InterpretedTransaction } from "@/lib/money-flow/types";

export function isCleared(txn: InterpretedTransaction): boolean {
  return (txn.status ?? "CLEARED") === "CLEARED";
}

/** Spec 10 tile value: `base_amount`, falling back to `amount` for older rows. */
export function tileAmount(txn: InterpretedTransaction): number {
  return txn.baseAmount ?? txn.amount;
}

/**
 * Spec 10 Actual Savings: CLEARED TRANSFER IN to a savings account, or
 * user-flagged. Inflow only. Unmatched internals do not count — the other leg
 * has to be found. No Soft pools; nickname/key is the only savings signal
 * until an account-type registry exists.
 */
export function isActualSavings(txn: InterpretedTransaction): boolean {
  if (!isCleared(txn)) return false;
  if (tileAmount(txn) <= 0) return false;
  if (!txn.transferPair) return false;
  return Boolean(txn.userFlaggedSavings) || looksLikeSavingsAccount(txn);
}

function looksLikeSavingsAccount(txn: InterpretedTransaction): boolean {
  const haystack = [txn.accountId, txn.accountKey].filter(Boolean).join(" ");
  return /\bsavings?\b|\bsaver\b|save!!/i.test(haystack);
}
