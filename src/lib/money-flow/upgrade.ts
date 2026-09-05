/**
 * Movements stored under the old thirteen-tag model, read into the new one.
 *
 * Run on the way out of storage rather than as a one-off rewrite, so a ledger that has
 * been sitting in a browser since before the taxonomy existed reads correctly the first
 * time it is opened and nobody is shown a migration wizard. It is idempotent: a row that
 * already carries a category key is handed straight back.
 *
 * Two of the old tags cannot be mapped from their wording alone, and both are handled by
 * refusing to guess:
 *
 * - **Income** was applied to payments as well as receipts, so a debit wearing it was
 *   always a misreading. It goes to the review queue rather than becoming negative income.
 * - **Goals** was never a category. `categorize.ts` handed it out for anything reading
 *   like a transfer, so it means "the reader thought this was internal" — a claim only
 *   finding the other leg can settle. It goes to the review queue too, and the pairing
 *   layer marks it `moved` on the next read if the other leg is really there.
 */

import { categoryForLegacyTag, isCategoryKey, OTHER, typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";

/** A row as it may be sitting in storage: either shape, or halfway between. */
export type StoredTransaction = Omit<InterpretedTransaction, "categoryKey" | "type"> & {
  categoryKey?: string;
  type?: string;
  /** The old display-name category, which doubled as the first tag. */
  category?: string;
  /** The old provenance field, replaced by `decidedBy`. */
  tagSource?: "rules" | "ai" | "user";
};

const FROM_TAG_SOURCE: Record<string, DecidedBy> = {
  user: "said",
  ai: "ai",
  rules: "rules",
};

export function upgradeTransaction(row: StoredTransaction): InterpretedTransaction {
  const { category, tagSource, ...rest } = row;

  if (isCategoryKey(row.categoryKey)) {
    const categoryKey = row.categoryKey;
    return {
      ...rest,
      categoryKey,
      type: typeForCategory(categoryKey, row.amount),
      ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    };
  }

  // The old model kept the category in the first tag as well as its own field, so the
  // tags that survive are the ones after it — which is what a tag was always meant to be.
  const held = (row.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const primary = (category ?? held[0] ?? "").trim();
  const others = held.filter((tag) => tag.toLowerCase() !== primary.toLowerCase());

  const mapped = categoryForLegacyTag(primary);
  const settled = tagSource === "user";
  const categoryKey = resolve(primary, mapped, settled, row.amount);
  // A tag the person invented is theirs and is kept — as a tag, which is where a name the
  // taxonomy has never heard of belongs.
  const tags = mapped || !primary || isReserved(primary) ? others : [primary, ...others];

  return {
    ...rest,
    categoryKey,
    type: typeForCategory(categoryKey, row.amount),
    decidedBy: decided(categoryKey, tagSource),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function upgradeTransactions(rows: StoredTransaction[]): InterpretedTransaction[] {
  return rows.map(upgradeTransaction);
}

/** The three old tags that meant something other than a category. */
function isReserved(tag: string): boolean {
  return ["income", "goals", "other"].includes(tag.toLowerCase());
}

function resolve(primary: string, mapped: string | null, settled: boolean, amount: number): string {
  if (mapped && mapped !== OTHER) return mapped;
  const name = primary.toLowerCase();
  // Other meant both "nothing matched" and "I looked and it is miscellaneous". Only the
  // second was a decision, and only the person's own edit tells them apart.
  if (name === "other") return settled ? OTHER : UNCATEGORISED;
  // Income on a payment was always a misreading, however deliberately it was applied, so
  // it is asked about rather than carried across as negative earnings.
  if (name === "income") return settled && amount > 0 ? "income.other" : UNCATEGORISED;
  return UNCATEGORISED;
}

function decided(categoryKey: string, tagSource: string | undefined): DecidedBy {
  if (categoryKey === UNCATEGORISED) return "unreviewed";
  return FROM_TAG_SOURCE[tagSource ?? ""] ?? "rules";
}
