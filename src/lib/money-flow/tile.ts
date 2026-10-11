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
