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
  migrateStoredCategory,
  OTHER,
  splitSuggestion,
  typeForCategory,
  UNCATEGORISED,
} from "@/lib/money-flow/taxonomy";
import { hasSource, sourceValue } from "@/lib/money-flow/source";
import { nameFromPrintedLines } from "@/lib/money-flow/up-statement";
import type { DecidedBy, InterpretedTransaction, SourceRow } from "@/lib/money-flow/types";

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
  const { category, tagSource, ...stored } = row;
  const rest = { ...stored, merchant: printedName(stored) };

  if (typeof row.categoryKey === "string" && row.categoryKey.trim()) {
    const migrated = migrateStoredCategory(row.categoryKey, row.tags);
    const tags = [...new Set([...(migrated.tag ? [migrated.tag] : []), ...(row.tags ?? [])])];
    return {
      ...rest,
      categoryKey: migrated.categoryKey,
      type: typeForCategory(migrated.categoryKey, row.amount),
      ...(tags.length > 0 ? { tags } : {}),
      ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    };
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
    upgraded.merchant === row.merchant &&
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

/**
 * The name a row would carry if its statement were read today.
 *
 * Movements imported before the bank adapters settled a name kept a tidied copy of it —
 * "Kfc" for KFC, "Osko Payment Received" for the person who actually paid. Their source
 * cells arrive later, when the same file is uploaded again, and this is what turns those
 * cells back into the name the bank printed.
 *
 * Only rows the statement described. A movement identified by its name alone — OFX, QIF,
 * a loose text statement — would take a new fingerprint if the name moved, and the same
 * money would import a second time. Every row carrying source cells today also carries a
 * description, so nothing that needs this is excluded by the guard.
 */
function printedName(row: Omit<StoredTransaction, "category" | "tagSource">): string {
  if (!row.description?.trim()) return row.merchant;
  if (!hasSource(row.source)) return collapse(row.bank?.merchant ?? "") || row.merchant;
  return fromPrintedCells(row.source) || collapse(row.bank?.merchant ?? "") || row.merchant;
}

/**
 * Which cell named a movement, in the two banks that existed before the adapters answered
 * this themselves. Deliberately frozen: a bank added from here on names its movements as
 * it reads them, so nothing new is ever added to this list.
 */
function fromPrintedCells(source: SourceRow | undefined): string {
  const merchantName = collapse(sourceValue(source, "Merchant Name"));
  if (merchantName) return merchantName;

  const lines = sourceValue(source, "Lines");
  if (lines) {
    const printed = nameFromPrintedLines(lines.split(/\n/));
    if (printed) return printed;
  }

  return collapse(sourceValue(source, "Transaction Details") || sourceValue(source, "Description"));
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  if (name === "income") return settled && amount > 0 ? "other-income" : UNCATEGORISED;
  return UNCATEGORISED;
}

function decided(categoryKey: string, tagSource: string | undefined): DecidedBy {
  if (categoryKey === UNCATEGORISED) return "unreviewed";
  return FROM_TAG_SOURCE[tagSource ?? ""] ?? "rules";
}
