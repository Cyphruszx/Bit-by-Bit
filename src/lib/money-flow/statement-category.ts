/**
 * What the bank called it — read as evidence, never handed back as the answer.
 *
 * A bank's own category is the weakest signal in the pipeline and used to be one of the
 * strongest. NAB files a year of Medicare revenue under "Refund" and calls 212 movements a
 * transfer when 54 of them are, so the two labels it is most confident about are the two
 * that would do the most damage if believed. Everything here therefore either sits below
 * the merchant rules, or is not a category at all.
 *
 * `looksInternal` is the reason the bank's wording is worth keeping even though it cannot
 * be trusted: it is the only record of which movements a bank *thought* were internal, and
 * that is exactly what a person needs told when a transfer's other leg never turned up.
 */

import { categoryForBankLabel } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/** Everything a statement said about a movement, in its own words. */
type AsWritten = Pick<InterpretedTransaction, "bank" | "description" | "merchant">;

function asWritten(txn: AsWritten | undefined): string {
  return [txn?.bank?.category, txn?.bank?.type, txn?.description, txn?.merchant].filter(Boolean).join(" ");
}

/**
 * Bank labels onto categories, for the movements no merchant rule recognised. Direction
 * decides the rest — the same label means different things on either side of the ledger.
 */
const BANK_HINTS: Array<[RegExp, string, ("in" | "out")?]> = [
  [/\bgrocer/i, "groceries.groceries"],
  [/\bfuel|petrol/i, "car.fuel"],
  [/\brestaurant|takeaway|dining|eating out|coffee/i, "eating-out.restaurants"],
  [/\bmedical|health|pharmacy/i, "medical", "out"],
  [/\bgovernment|centrelink|benefit/i, "other-income.government-benefit", "in"],
  [/\bother income|salary|wage|payroll/i, "salary", "in"],
  [/\bshopping|retail/i, "shopping"],
  [/\bentertainment/i, "entertainment"],
  [/\butility|utilities|bills/i, "utilities"],
  [/\bsubscription/i, "entertainment.streaming"],
  [/\btravel|holiday/i, "travel"],
  [/\bhousing|rent|mortgage/i, "rent-mortgage"],
  [/\bloans?\b/i, "bank-fees.interest-charged", "out"],
  [/\binterest/i, "other-income.interest-earned", "in"],
];

/** A category the bank's label suggests, or null. Never the last word on a movement. */
export function categoryFromBankLabel(raw: string | undefined, amount: number): string | null {
  const label = raw?.trim() ?? "";
  if (!label || /^(uncategoris[ed]+|uncategoriz[ed]+|other|general)$/i.test(label)) return null;
  const mapped = categoryForBankLabel(label);
  if (mapped) return mapped;
  const direction = amount > 0 ? "in" : "out";
  for (const [pattern, category, when] of BANK_HINTS) {
    if (when && when !== direction) continue;
    if (pattern.test(label)) return category;
  }
  return null;
}

/**
 * Whether the bank thought this money was going to or coming from another of the person's
 * own accounts.
 *
 * Never a type on its own — only finding the other leg can settle that. It is what lets
 * the app say "this looks internal and its other leg is not here, so it still counts",
 * which is a far more useful thing to tell somebody than silently believing either way.
 */
export function looksInternal(txn: AsWritten | undefined): boolean {
  // Every part of what the statement wrote, because banks put this claim in different
  // places: NAB in a Category column reading "Transfers out", a plain CSV export in the
  // description reading "TRANSFER TO SAVINGS 082". Both are the bank talking.
  //
  // Open at the end on purpose. Banks inflect these words — "Transfers out", "Refunded" —
  // and closing the boundary silently drops the very rows the wording was kept for.
  return /\b(transfer|tfr|internal|sweep)/i.test(asWritten(txn));
}

/**
 * Whether the bank thought this credit was money coming back.
 *
 * Worth as little as the transfer label and worth keeping for the same reason. NAB files a
 * practice's whole year of Medicare revenue here — $120,844.20 — so believing it would
 * erase a year of earnings. It is used to decide which credits are worth *looking* for a
 * reversed payment against, and to caption the ones no payment was ever found for.
 */
export function looksReturned(txn: AsWritten | undefined): boolean {
  return /\b(refund|reversal|rebate|chargeback|returned)/i.test(asWritten(txn));
}

export function tableInterpretationNotes(headers: string[]): string[] {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const has = (name: string) => normalized.some((header) => header === name || header.includes(name));
  if (has("merchant name") && has("transaction type") && has("category")) {
    return ["Read as a NAB account export. Amounts and merchants come from the statement columns, and its category is kept as a note rather than used as the answer."];
  }
  if (has("category")) {
    return ["The statement's own category is kept for reference and used only as a hint."];
  }
  return [];
}
