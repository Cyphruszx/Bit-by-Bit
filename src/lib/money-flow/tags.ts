/**
 * Tags, which are now only tags.
 *
 * This file used to hold both axes at once: `withTags` wrote the first tag back into
 * `category`, so the two were the same string and a tag could silently move a total. The
 * rule they are separated by is one sentence — **a movement has exactly one category, for
 * what the money was for, and any number of tags, for anything else you want to find it
 * by** — and the thing that enforces it is that nothing in here touches a figure.
 *
 * The old "primary tag and optional sub-tag" control was a two-level category wearing a
 * tag's name. The levels live in the taxonomy now, so the control is gone.
 */

import { merchantKey } from "@/lib/money-flow/redact";
import { isCategoryKey, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";

export function tidyTag(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** What the money was for. Always a taxonomy key, never a display name. */
export function categoryOf(txn: Pick<InterpretedTransaction, "categoryKey">): string {
  return isCategoryKey(txn.categoryKey) ? txn.categoryKey : UNCATEGORISED;
}

export function tagsOf(txn: Pick<InterpretedTransaction, "tags">): string[] {
  return uniqueTags((txn.tags ?? []).map(tidyTag).filter(Boolean));
}

/**
 * A person choosing a category settles it, which is the highest rung on the ladder: no
 * later re-read, better rule or model call moves it again.
 */
export function withCategory(
  txn: InterpretedTransaction,
  categoryKey: string,
  decidedBy: DecidedBy = "said",
): InterpretedTransaction {
  const next = isCategoryKey(categoryKey) ? categoryKey : UNCATEGORISED;
  return { ...txn, categoryKey: next, decidedBy };
}

export function withTags(txn: InterpretedTransaction, tags: string[]): InterpretedTransaction {
  const next = uniqueTags(tags.map(tidyTag).filter(Boolean));
  if (next.length === 0) {
    const bare = { ...txn };
    delete bare.tags;
    return bare;
  }
  return { ...txn, tags: next };
}

/** Statements name a merchant inconsistently in case, so match on the tidied name. */
export function sameMerchant(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function merchantRows(
  transactions: InterpretedTransaction[],
  merchant: string,
): InterpretedTransaction[] {
  return transactions.filter((txn) => sameMerchant(txn.merchant, merchant));
}

/**
 * The same category on every movement of one merchant, leaving every other movement alone.
 *
 * Matched on the normalised name rather than the written one, so re-filing a payee the
 * bank stamps with a fresh reference number each time catches all of them — which is what
 * the person meant, and what the review queue promised when it asked once.
 */
export function categorizeMerchant(
  transactions: InterpretedTransaction[],
  merchant: string,
  categoryKey: string,
): InterpretedTransaction[] {
  const wanted = merchantKey({ merchant });
  return transactions.map((txn) => (merchantKey(txn) === wanted ? withCategory(txn, categoryKey) : txn));
}

export function tagMerchant(
  transactions: InterpretedTransaction[],
  merchant: string,
  tags: string[],
): InterpretedTransaction[] {
  return transactions.map((txn) => (sameMerchant(txn.merchant, merchant) ? withTags(txn, tags) : txn));
}

export function renameTag(transactions: InterpretedTransaction[], from: string, to: string): InterpretedTransaction[] {
  const nextName = tidyTag(to);
  if (!nextName) return transactions;
  const source = from.trim().toLowerCase();
  return transactions.map((txn) =>
    withTags(
      txn,
      tagsOf(txn).map((tag) => (tag.toLowerCase() === source ? nextName : tag)),
    ),
  );
}

export function removeTag(transactions: InterpretedTransaction[], name: string): InterpretedTransaction[] {
  const source = name.trim().toLowerCase();
  return transactions.map((txn) => withTags(txn, tagsOf(txn).filter((tag) => tag.toLowerCase() !== source)));
}

export function allTags(transactions: InterpretedTransaction[]): string[] {
  return uniqueTags(transactions.flatMap(tagsOf)).sort((a, b) => a.localeCompare(b));
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
