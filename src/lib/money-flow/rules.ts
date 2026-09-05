/**
 * What the app has learned from being corrected.
 *
 * A person who re-files KFC once should not have to re-file it every month. The app
 * already had half of this: correcting a movement offered to carry the change across that
 * merchant's other movements, but only the ones already on screen — the next statement
 * arrived and the rules table got its old answer back.
 *
 * So a correction is remembered, silently and from the first time. That is the same call
 * verdicts already make, where settling one payer settles all 172 of its movements, and it
 * is made for the same reason: a person who has answered a question once has answered it.
 *
 * The scope is the merchant, which is the one a person can hold in their head — "Woolworths
 * is groceries" — and the one the existing "apply to all" affordance already used, so a
 * learned rule is just the durable version of something the app was already offering.
 * Narrower scopes (this account, this amount) are deferred until something asks for them.
 *
 * Everything here is reversible and legible: `whatWasLearned` renders the store as
 * sentences a person can read and undo, without the words "rule engine" appearing anywhere.
 */

import { merchantKey } from "@/lib/money-flow/redact";
import { categoryPath, isCategoryKey } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type LearnedRule = {
  categoryKey: string;
  /** What the reader had said before the person disagreed, so the list can show the change. */
  from?: string;
  /** When they said so, so a later correction wins over an earlier one. */
  at: string;
};

export type Rules = Record<string, LearnedRule>;

/**
 * The merchant a correction is filed under: normalised, so the reference number a bank
 * appends to every row does not turn one payee into a dozen things to teach separately.
 */
export function ruleKeyFor(txn: Pick<InterpretedTransaction, "merchant">): string {
  return merchantKey(txn);
}

export function ruleFor(rules: Rules, txn: Pick<InterpretedTransaction, "merchant">): LearnedRule | undefined {
  const held = rules[ruleKeyFor(txn)];
  return held && isCategoryKey(held.categoryKey) ? held : undefined;
}

/**
 * Remembers a correction. A category the taxonomy does not know is not remembered at all,
 * because a rule that cannot be applied is worse than none: it would sit in the learned
 * list claiming to do something.
 */
export function learn(
  rules: Rules,
  txn: Pick<InterpretedTransaction, "merchant" | "categoryKey">,
  categoryKey: string,
  at: string,
): Rules {
  if (!isCategoryKey(categoryKey)) return rules;
  const key = ruleKeyFor(txn);
  const from = txn.categoryKey;
  return {
    ...rules,
    [key]: { categoryKey, at, ...(from && from !== categoryKey ? { from } : {}) },
  };
}

export function forget(rules: Rules, key: string): Rules {
  if (!(key in rules)) return rules;
  const next = { ...rules };
  delete next[key];
  return next;
}

export type LearnedThing = {
  key: string;
  /** The merchant as the person last saw it written, rather than the lowercased key. */
  merchant: string;
  categoryKey: string;
  /** Plain English, for a list that never says "rule". */
  sentence: string;
  /** How many movements it is holding, so a person can see what undoing it would cost. */
  count: number;
  at: string;
};

/**
 * The learned store as sentences, commonest first.
 *
 * A rule with nothing behind it any more — the statements that had that merchant were
 * removed — is still listed, with a count of zero, rather than quietly disappearing. It is
 * still in force for the next import, and a person deserves to see the thing that will act
 * on their data.
 */
export function whatWasLearned(rules: Rules, transactions: InterpretedTransaction[]): LearnedThing[] {
  const seen = new Map<string, { merchant: string; count: number }>();
  for (const txn of transactions) {
    const key = merchantKey(txn);
    const held = seen.get(key);
    seen.set(key, { merchant: held?.merchant ?? txn.merchant, count: (held?.count ?? 0) + 1 });
  }

  return Object.entries(rules)
    .filter(([, rule]) => isCategoryKey(rule.categoryKey))
    .map(([key, rule]) => {
      const held = seen.get(key);
      const merchant = held?.merchant ?? key;
      return {
        key,
        merchant,
        categoryKey: rule.categoryKey,
        sentence: `${merchant} is ${categoryPath(rule.categoryKey)}`,
        count: held?.count ?? 0,
        at: rule.at,
      };
    })
    .sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant));
}
