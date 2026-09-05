/**
 * The order the app is allowed to decide what a movement was for.
 *
 * Every rung is cheaper, or more certain, or both, than the one below it. A movement stops
 * at the first rung that can answer, so the expensive and least reliable one — asking a
 * model — only ever sees what nothing else could place, and a confident wrong answer can
 * never land on top of a right one.
 *
 *   said        the person chose this, on this movement
 *   learned     the person corrected this merchant before
 *   paired      the ledger found the other leg, or the payment being reversed
 *   merchant    this ledger's own history for this merchant
 *   rules       the merchant table, applied when the statement was read
 *   bank        the statement's own label, which is a hint and never an answer
 *   ai          a model, constrained to the taxonomy
 *   unreviewed  nothing could say, and saying so is the honest answer
 *
 * `paired` sits above the merchant and the rules because it is the only rung backed by
 * arithmetic rather than by a guess about words: two legs of the same amount in two
 * accounts is evidence, and "Woolworths is usually groceries" is not.
 *
 * Runs over the whole ledger and reaches the same answer from the same movements, so
 * importing another statement re-decides everything rather than layering on top.
 */

import { merchantKey } from "@/lib/money-flow/redact";
import { ruleFor, type Rules } from "@/lib/money-flow/rules";
import { typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";

const RUNGS: DecidedBy[] = ["said", "learned", "paired", "merchant", "rules", "bank", "ai", "unreviewed"];

const RANK = new Map<DecidedBy, number>(RUNGS.map((rung, index) => [rung, index]));

/** Whether the first rung outranks the second. Equal rungs do not beat each other. */
export function outranks(rung: DecidedBy, held: DecidedBy | undefined): boolean {
  return (RANK.get(rung) ?? RUNGS.length) < (RANK.get(held ?? "unreviewed") ?? RUNGS.length);
}

/** Whether a movement is still waiting for somebody to say what it was for. */
export function needsReview(txn: InterpretedTransaction): boolean {
  return txn.categoryKey === UNCATEGORISED;
}

export type ClassifyOptions = {
  rules?: Rules;
};

/**
 * Walks the ladder over every movement.
 *
 * Only the two rungs that need the whole ledger are applied here — a correction the person
 * made about this merchant, and what this ledger already says about it. The rest were
 * settled when the statement was read, or are settled after this by the matchers and by
 * whatever the person has said outright.
 */
export function classify(
  transactions: InterpretedTransaction[],
  options: ClassifyOptions = {},
): InterpretedTransaction[] {
  const rules = options.rules ?? {};
  const remembered = merchantMemory(transactions);

  return transactions.map((txn) => {
    // A movement the person settled themselves is never re-decided. Nothing below them on
    // the ladder gets to argue, and that is the whole reason the ladder is ordered.
    if (txn.decidedBy === "said") return txn;

    const learned = ruleFor(rules, txn);
    if (learned && outranks("learned", txn.decidedBy)) {
      return placed(txn, learned.categoryKey, "learned");
    }

    const known = remembered.get(merchantKey(txn));
    if (known && outranks("merchant", txn.decidedBy)) {
      return placed(txn, known, "merchant");
    }

    return txn;
  });
}

/**
 * What this ledger already knows about each merchant, from the movements the person has
 * settled by hand.
 *
 * This is what catches a correction made before the app was remembering them, and a
 * correction carried in from another device. The learned store is the durable record; this
 * is the ledger agreeing with it.
 */
function merchantMemory(transactions: InterpretedTransaction[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const txn of transactions) {
    if (txn.decidedBy !== "said" || txn.categoryKey === UNCATEGORISED) continue;
    known.set(merchantKey(txn), txn.categoryKey);
  }
  return known;
}

function placed(txn: InterpretedTransaction, categoryKey: string, decidedBy: DecidedBy): InterpretedTransaction {
  if (txn.categoryKey === categoryKey && txn.decidedBy === decidedBy) return txn;
  return { ...txn, categoryKey, type: typeForCategory(categoryKey, txn.amount), decidedBy };
}
