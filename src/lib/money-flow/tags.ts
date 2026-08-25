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

export function withTags(txn: InterpretedTransaction, tags: string[]): InterpretedTransaction {
  const next = uniqueTags(tags.map(tidyTag).filter(Boolean));
  const primary = next[0] ?? "Other";
  return { ...txn, tags: next.length > 0 ? next : ["Other"], category: primary };
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

function uniqueTags(tags: string[]): string[] {
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
