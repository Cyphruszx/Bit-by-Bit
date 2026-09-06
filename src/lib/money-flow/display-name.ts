import type { InterpretedTransaction } from "@/lib/money-flow/types";

type Named = Pick<InterpretedTransaction, "merchant" | "description" | "bank">;

/**
 * The name to show, for a reader that did not settle one itself.
 *
 * The bank that owns a statement is the only thing that knows which of its cells names a
 * movement — NAB writes a shop in Merchant Name and a payee in Transaction Details, Up
 * prints the counterparty in front of the rail. Each adapter already puts that answer in
 * the movement's own `merchant` or `description`, so all this has to do is prefer them in
 * order and tidy the whitespace.
 *
 * It used to reach into the stored source cells and ask for those column names by hand,
 * which put two banks' vocabularies back into shared code that every row passes through —
 * the coupling the adapters exist to remove. A statement stored before the adapters named
 * it is a question about an older shape, and `upgrade.ts` answers it.
 */
export function displayName(txn: Named): string {
  return collapse(txn.bank?.merchant || txn.merchant || txn.description || "") || "Unknown";
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
