import type { InterpretedTransaction } from "@/lib/money-flow/types";

type Named = Pick<InterpretedTransaction, "merchant" | "description" | "bank">;

/**
 * The name to show when a reader did not settle one itself.
 *
 * Prefers the merchant the bank named, then the working merchant, then the wording
 * around the movement. Collapses whitespace. Says Unknown when none of those have
 * anything in them.
 *
 * Which cell of a statement names a movement is the bank's question, answered in that
 * bank's adapter as it reads. This function does not look at source cells. A row stored
 * before the adapters named it is recovered in upgrade.ts.
 */
export function displayName(txn: Named): string {
  return collapse(txn.bank?.merchant || txn.merchant || txn.description || "") || "Unknown";
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
