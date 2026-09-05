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

import {
  categoryForLegacyTag,
  isCategoryKey,
  OTHER,
  splitSuggestion,
  typeForCategory,
  UNCATEGORISED,
} from "@/lib/money-flow/taxonomy";
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
    const categoryKey = row.categoryKey as string;
    return {
      ...rest,
      categoryKey,
      type: typeForCategory(categoryKey, row.amount),
      ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    };
  }

  // A movement stored under the two-level model: `food.groceries` was one key and is now a
  // category and a tag. Every figure was already summed at the category, so nothing moves —
  // the detail simply stops being part of the key and becomes something to find it by.
  if (typeof row.categoryKey === "string" && row.categoryKey.includes(".")) {
    const split = splitSuggestion(row.categoryKey);
    if (split.categoryKey !== UNCATEGORISED) {
      return {
        ...rest,
        categoryKey: split.categoryKey,
        type: typeForCategory(split.categoryKey, row.amount),
        ...(split.tag ? { tags: [...new Set([...(row.tags ?? []), split.tag])] } : {}),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
      };
    }
  }

  // The old model kept the category in the first tag as well as its own field, so the
  // tags that survive are the ones after it — which is what a tag was always meant to be.
  const held = (row.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const primary = (category ?? held[0] ?? "").trim();
  const others = held.filter((tag) => tag.toLowerCase() !== primary.toLowerCase());

  const legacy = categoryForLegacyTag(primary);
  const fromLegacy = legacy ? splitSuggestion(legacy) : null;
  const mapped = fromLegacy && fromLegacy.categoryKey !== UNCATEGORISED ? fromLegacy.categoryKey : legacy;
  const settled = tagSource === "user";
  const categoryKey = resolve(primary, mapped, settled, row.amount);
  // A tag the person invented is theirs and is kept — as a tag, which is where a name the
  // taxonomy has never heard of belongs.
  const carried = mapped || !primary || isReserved(primary) ? others : [primary, ...others];
  // The detail the old tag carried — Groceries under Food & Drink — survives as a tag.
  const tags = [...new Set([...(fromLegacy?.tag ? [fromLegacy.tag] : []), ...carried])];

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

/**
 * Whether a stored row is already in the current model: a flat category key, no
 * leftover display-name category, no tagSource, tags already split off the old key.
 */
export function storedInCurrentModel(row: StoredTransaction): boolean {
  if (row.category != null && String(row.category).trim() !== "") return false;
  if (row.tagSource != null) return false;
  if (!isCategoryKey(row.categoryKey)) return false;
  const upgraded = upgradeTransaction(row);
  return (
    upgraded.categoryKey === row.categoryKey &&
    sameStrings(upgraded.tags, row.tags) &&
    upgraded.decidedBy === row.decidedBy
  );
}

/** The current-model row, or the same object when nothing needs writing. */
export function persistStoredTransaction(row: StoredTransaction): StoredTransaction {
  if (storedInCurrentModel(row)) return row;
  return upgradeTransaction(row);
}

function sameStrings(a?: string[], b?: string[]): boolean {
  const left = [...(a ?? [])].map((value) => value.trim()).filter(Boolean).sort();
  const right = [...(b ?? [])].map((value) => value.trim()).filter(Boolean).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
  if (name === "income") return settled && amount > 0 ? "income" : UNCATEGORISED;
  return UNCATEGORISED;
}

function decided(categoryKey: string, tagSource: string | undefined): DecidedBy {
  if (categoryKey === UNCATEGORISED) return "unreviewed";
  return FROM_TAG_SOURCE[tagSource ?? ""] ?? "rules";
}
