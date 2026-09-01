import type { InterpretedTransaction } from "@/lib/money-flow/types";

export function tidyTag(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function tagsOf(txn: Pick<InterpretedTransaction, "category" | "tags">): string[] {
  const fromTags = uniqueTags((txn.tags ?? []).map(tidyTag).filter(Boolean));
  if (fromTags.length > 0) return fromTags;
  const fallback = tidyTag(txn.category);
  return fallback ? [fallback] : ["Other"];
}

export function primaryTag(txn: Pick<InterpretedTransaction, "category" | "tags">): string {
  return tagsOf(txn)[0] ?? "Other";
}

export function subTags(txn: Pick<InterpretedTransaction, "category" | "tags">): string[] {
  return tagsOf(txn).slice(1);
}

export function withTags(txn: InterpretedTransaction, tags: string[]): InterpretedTransaction {
  const next = uniqueTags(tags.map(tidyTag).filter(Boolean));
  const primary = next[0] ?? "Other";
  return { ...txn, tags: next.length > 0 ? next : ["Other"], category: primary, tagSource: "user" };
}

export function withPrimary(txn: InterpretedTransaction, name: string): InterpretedTransaction {
  const next = tidyTag(name);
  const rest = subTags(txn).filter((tag) => tag.toLowerCase() !== next.toLowerCase());
  return withTags(txn, next ? [next, ...rest] : rest);
}

export function withSubTags(txn: InterpretedTransaction, nextSubs: string[]): InterpretedTransaction {
  return withTags(txn, [primaryTag(txn), ...nextSubs]);
}

export function makePrimary(txn: InterpretedTransaction, name: string): InterpretedTransaction {
  const next = tidyTag(name);
  const others = tagsOf(txn).filter((tag) => tag.toLowerCase() !== next.toLowerCase());
  return withTags(txn, next ? [next, ...others] : others);
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

/** Whether these tags would leave the movement exactly as it already is. */
export function hasTags(txn: InterpretedTransaction, tags: string[]): boolean {
  const current = tagsOf(txn);
  const next = tagsOf(withTags(txn, tags));
  return current.length === next.length && current.every((tag, index) => tag === next[index]);
}

/** The same tags on every movement of one merchant, leaving every other movement alone. */
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

export function allPrimaryTags(transactions: InterpretedTransaction[]): string[] {
  return uniqueTags(transactions.map(primaryTag)).sort((a, b) => a.localeCompare(b));
}

export function allSubTags(transactions: InterpretedTransaction[]): string[] {
  return uniqueTags(transactions.flatMap(subTags)).sort((a, b) => a.localeCompare(b));
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
