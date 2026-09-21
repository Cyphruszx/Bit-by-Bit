/**
 * The order the app is allowed to decide what a movement was for.
 *
 * Every rung is cheaper, or more certain, or both, than the one below it. A movement stops
 * at the first rung that can answer, so the expensive and least reliable one — asking a
 * model — only ever sees what nothing else could place, and a confident wrong answer can
 * never land on top of a right one.
 *
 *   user_overridden / said   the person chose this, on this movement
 *   user_rule / learned      the person corrected this merchant before
 *   paired                   Spec 7 RESOLVE wrote the other leg (Core ingest never does this)
 *   merchant                 this ledger's own history for this merchant
 *   rules                    the merchant table, applied when the statement was read
 *   bank                     the statement's own label, which is a hint and never an answer
 *   ai                       a model, constrained to the taxonomy
 *   unreviewed               nothing could say, and saying so is the honest answer
 *
 * Spec 3 lists user_rule before user_overridden. A merchant rule must not overwrite
 * a row the person settled, or Spec 7 RESOLVE and Spec 6c merge overrides vanish.
 *
 * `paired` sits above the merchant and the rules because it is the only rung backed by
 * arithmetic rather than by a guess about words: two legs of the same amount in two
 * accounts is evidence, and "Woolworths is usually groceries" is not.
 *
 * Runs over the whole ledger and reaches the same answer from the same movements, so
 * importing another statement re-decides everything rather than layering on top.
 */

import { resolveMerchant } from "@/lib/merchants/resolve";
import { merchantKey } from "@/lib/money-flow/redact";
import { ruleFor, type Rules } from "@/lib/money-flow/rules";
import { authorityOf, isUserOverridden } from "@/lib/money-flow/movement-kind";
import { looksLikeCreditCardRepayment } from "@/lib/money-flow/statement-category";
import { categoryForBankLabel, splitSuggestion, typeForCategory, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { DecidedBy, InterpretedTransaction } from "@/lib/money-flow/types";

function rank(decidedBy: DecidedBy | undefined): number {
  const authority = authorityOf(decidedBy);
  if (authority === "user_overridden") return 0;
  if (authority === "user_rule") return 1;
  if (decidedBy === "paired") return 2;
  if (decidedBy === "merchant") return 3;
  if (decidedBy === "rules") return 4;
  if (decidedBy === "bank") return 5;
  if (decidedBy === "ai") return 6;
  return 7;
}

/** Whether the first rung outranks the second. Equal rungs do not beat each other. */
export function outranks(rung: DecidedBy, held: DecidedBy | undefined): boolean {
  return rank(rung) < rank(held ?? "unreviewed");
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
    if (isUserOverridden(txn)) return txn;

    const learned = ruleFor(rules, txn);
    if (learned && outranks("user_rule", txn.decidedBy)) {
      return coreKind(placed(txn, learned.categoryKey, "user_rule"));
    }

    const known = remembered.get(merchantKey(txn));
    if (known && outranks("merchant", txn.decidedBy)) {
      return coreKind(placed(txn, known, "merchant"));
    }

    // Seed is the same `rules` rung as the reader table: aliases / NSI / MCC, never
    // above a person or a proved pair, and only for rows still waiting.
    if (txn.amount <= 0 && needsReview(txn) && outranks("rules", txn.decidedBy)) {
      const seed = resolveMerchant([txn.merchant, txn.description].filter(Boolean).join(" "), {
        mcc: txn.bank?.mcc,
      });
      if (seed) return coreKind(placed(txn, seed.categoryKey, "rules"));
    }

    // Only unsorted rows: a bank label the person mapped, after the merchant ladder
    // has had its say, and never over a category that was already decided.
    if (needsReview(txn)) {
      const mapped = categoryForBankLabel(txn.bank?.category);
      if (mapped) {
        const { categoryKey } = splitSuggestion(mapped);
        if (categoryKey !== UNCATEGORISED) return coreKind(placed(txn, categoryKey, "bank"));
      }
    }

    return coreKind(txn);
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
    if (!isUserOverridden(txn) || txn.categoryKey === UNCATEGORISED) continue;
    known.set(merchantKey(txn), txn.categoryKey);
  }
  return known;
}

function placed(txn: InterpretedTransaction, categoryKey: string, decidedBy: DecidedBy): InterpretedTransaction {
  if (txn.categoryKey === categoryKey && txn.decidedBy === decidedBy) return txn;
  return { ...txn, categoryKey, type: typeForCategory(categoryKey, txn.amount), decidedBy };
}

/** Core heuristic: a credit-card repayment from a deposit account is TRANSFER, not Spending. */
function coreKind(txn: InterpretedTransaction): InterpretedTransaction {
  if (authorityOf(txn.decidedBy) !== "core" && txn.decidedBy !== "unreviewed") return txn;
  if (!looksLikeCreditCardRepayment(txn)) return txn;
  if (txn.type === "TRANSFER") return txn;
  return { ...txn, type: "TRANSFER" };
}
