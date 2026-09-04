/**
 * Who paid, when one payer writes its name more than one way.
 *
 * A bank description is not a stable identifier. Medicare pays the same practice as
 * "MC BBS785 MCARE BENEFITS STEVEN OH", as "MC BBS### MCARE BENEFITS" with no name at
 * all, and as "MC BBS### STEVEN OH MCARE BENEFITS" with the name in the middle. Read
 * literally that is three payers, and a year of billing arrives split three ways: the
 * rate is wrong, and the app asks the same question three times.
 *
 * Sorting the words settles where a name sits, and is done silently because it cannot
 * join two payers that are really different. A name dropping out entirely is a judgement
 * call, so it is only ever offered: a wrong merge fuses two payers' totals and is hard to
 * notice afterwards, while a wrong split is visible and costs one click to undo.
 */

import { accountIdOf, accountLabel, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { roundMoney } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { rawLikeKey, wordsOf } from "@/lib/money-flow/verdicts";

/**
 * A single word is not enough to go on. "Payment" sits inside half the descriptions a
 * bank writes, and absorbing every one of them into the biggest group is exactly the
 * mistake this is careful not to make on its own.
 */
const ENOUGH_WORDS = 2;

export type PayerGroup = {
  /** The key a merge is recorded against, before any merge is applied. */
  key: string;
  label: string;
  account: string;
  /** Money in or money out. Joining across the two would make one verdict settle both. */
  direction: "in" | "out";
  words: string[];
  count: number;
  total: number;
  first: string;
  last: string;
};

export type PayerSuggestion = {
  /** The wording that would remain, which is the one on the most movements. */
  keep: string;
  merge: string;
  keepLabel: string;
  mergeLabel: string;
  account: string;
  /** What would move, so the offer says its own size before it is taken. */
  count: number;
  amount: number;
  reason: string;
};

/** Movements gathered by the wording their statement gave them, richest first. */
export function payerGroups(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): PayerGroup[] {
  const grouped = new Map<string, PayerGroup>();

  for (const txn of transactions) {
    if (txn.transferPair || txn.refundPair) continue;
    const key = rawLikeKey(txn, registry);
    const held = grouped.get(key);
    grouped.set(key, {
      key,
      label: held?.label ?? (txn.description?.trim() || txn.merchant),
      account: held?.account ?? accountIdOf(txn, registry),
      direction: held?.direction ?? (txn.amount > 0 ? "in" : "out"),
      words: held?.words ?? wordsOf(txn),
      count: (held?.count ?? 0) + 1,
      total: roundMoney((held?.total ?? 0) + Math.abs(txn.amount)),
      first: held && held.first < txn.dateIso ? held.first : txn.dateIso,
      last: held && held.last > txn.dateIso ? held.last : txn.dateIso,
    });
  }

  return [...grouped.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * Wordings that may be one payer. Offered, never applied.
 *
 * The test is containment: every word of the smaller wording appears in the larger, in
 * the same account and the same direction. That is what a name dropping off the end of a
 * description looks like, and it is narrow enough to leave two genuinely different payers
 * alone — "MCARE BENEFITS" and "VTA BENEFITS" share only the word they both are.
 */
export function payerSuggestions(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): PayerSuggestion[] {
  const groups = payerGroups(transactions, registry);
  const merged = registry.payers ?? {};
  const suggestions: PayerSuggestion[] = [];
  const spoken = new Set<string>();

  for (const smaller of groups) {
    if (smaller.words.length < ENOUGH_WORDS) continue;
    if (merged[smaller.key] || spoken.has(smaller.key)) continue;

    const containers = groups.filter(
      (larger) =>
        larger.key !== smaller.key &&
        !merged[larger.key] &&
        larger.account === smaller.account &&
        larger.direction === smaller.direction &&
        larger.words.length > smaller.words.length &&
        smaller.words.every((word) => larger.words.includes(word)),
    );

    // Words that fit inside more than one payer are not that payer's name, they are the
    // person's own. "JORDAN LEE" sits inside Medicare's wording and inside the DVA's, and
    // inside every transfer they ever made — so it says nothing about which is which.
    if (containers.length !== 1) continue;

    const larger = containers[0];
    // The wording on the most movements is the one a person recognises, so it stays.
    const [keep, merge] = larger.count >= smaller.count ? [larger, smaller] : [smaller, larger];
    spoken.add(smaller.key);
    suggestions.push({
      keep: keep.key,
      merge: merge.key,
      keepLabel: keep.label,
      mergeLabel: merge.label,
      account: smaller.account,
      count: merge.count,
      amount: merge.total,
      reason: missingWords(larger, smaller),
    });
  }

  return suggestions.sort((a, b) => b.amount - a.amount);
}

function missingWords(larger: PayerGroup, smaller: PayerGroup): string {
  const missing = larger.words.filter((word) => !smaller.words.includes(word));
  const where = accountLabel(smaller.account);
  if (missing.length === 0) return `The same wording in ${where}`;
  return `Same wording in ${where}, without ${missing.map((word) => `"${word}"`).join(" or ")}`;
}
