/**
 * What a person says about money the reader could not settle on its own.
 *
 * The reader gets a long way from statements alone — it pairs a transfer with its other
 * leg, and a refund with the payment it reverses — but some things are simply not in the
 * documents. A $25,000 credit from a lender looks exactly like income. So does a transfer
 * from an account whose statement has not been uploaded. Only the person knows.
 *
 * A verdict is kept beside the movements, never on them, and keyed by wording rather than
 * by row, so saying "this is my practice's billing, and so is every credit like it"
 * survives re-importing the statement and re-reading it with a better parser.
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { typeForCategory } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction, TransactionType } from "@/lib/money-flow/types";

/**
 * Why a person says a movement is or is not the household's own money in or out.
 *
 * These six were written before the type layer existed and turned out to be the type layer
 * — a person saying "borrowed money" and the reader working out `borrowed` are the same
 * statement, so they are now the same field. Each reason names the type it sets, which is
 * what stops a verdict and a reading from disagreeing in language while agreeing in fact.
 */
export type VerdictReason =
  | "earned"
  | "money-back"
  | "own-account"
  | "borrowed"
  | "spent"
  | "not-mine";

export type Verdict = {
  /** Whether this counts as income, or for a payment, as spending. */
  counts: boolean;
  because: VerdictReason;
  /** When they said so, so a later change wins over an earlier one. */
  at: string;
};

export type Verdicts = Record<string, Verdict>;

const REASONS: Record<
  VerdictReason,
  { counts: boolean; label: string; forCredit: boolean; type: TransactionType }
> = {
  earned: { counts: true, label: "Money I earned", forCredit: true, type: "earned" },
  "money-back": { counts: false, label: "Money coming back to me", forCredit: true, type: "returned" },
  "own-account": { counts: false, label: "From another of my accounts", forCredit: true, type: "moved" },
  borrowed: { counts: false, label: "Borrowed money", forCredit: true, type: "borrowed" },
  spent: { counts: true, label: "Money I spent", forCredit: false, type: "spent" },
  "not-mine": { counts: false, label: "Moved to another of my accounts", forCredit: false, type: "moved" },
};

export function reasonsFor(amount: number): { reason: VerdictReason; label: string }[] {
  const wantCredit = amount > 0;
  return Object.entries(REASONS)
    .filter(([, meaning]) => meaning.forCredit === wantCredit)
    .map(([reason, meaning]) => ({ reason: reason as VerdictReason, label: meaning.label }));
}

/** The type a verdict sets on the movements it settles. */
export function typeForReason(reason: VerdictReason): TransactionType {
  return REASONS[reason]?.type ?? "earned";
}

export function reasonLabel(reason: VerdictReason): string {
  return REASONS[reason]?.label ?? reason;
}

/**
 * A verdict from a reason. Whether it counts is decided from the reason itself and never
 * taken on trust, so a stored "borrowed" can never come back saying it was income.
 * An unknown reason falls back to "earned", which changes no total.
 */
export function verdictFor(reason: string, at: string): Verdict {
  const known = reason in REASONS ? (reason as VerdictReason) : "earned";
  return { counts: REASONS[known].counts, because: known, at };
}

/**
 * The one movement, told apart from every other. Used when a person means this row and
 * not the hundred that read like it.
 */
export function oneKey(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  return ["one", accountIdOf(txn, registry), txn.dateIso, txn.amount.toFixed(2), wording(txn)].join("|");
}

/**
 * Every movement that reads the same way: the same account, the same direction, the same
 * wording. A practice billing Medicare 172 times should be settled once, not 172 times.
 *
 * Two payers a person has said are one are one here, because a bank does not write a
 * payer's name the same way every time and nothing in the words can settle that alone.
 */
export function likeKey(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  return throughMerges(rawLikeKey(txn, registry), registry.payers);
}

/** The key before any merge a person has recorded, which is what a merge is recorded against. */
export function rawLikeKey(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  return ["like", accountIdOf(txn, registry), txn.amount > 0 ? "in" : "out", wording(txn)].join("|");
}

/** The wording a movement was filed under before words were sorted. */
function legacyLikeKey(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  return ["like", accountIdOf(txn, registry), txn.amount > 0 ? "in" : "out", asWritten(txn)].join("|");
}

/**
 * Follows a merge to the payer it ends at. Merges can chain when three wordings are
 * joined one after another, and a loop would be a bug rather than a thing to hang on.
 */
function throughMerges(key: string, merges: Record<string, string> | undefined): string {
  if (!merges) return key;
  const seen = new Set<string>();
  let at = key;
  while (merges[at] && !seen.has(at)) {
    seen.add(at);
    at = merges[at];
  }
  return at;
}

/**
 * How many movements a verdict on this one would settle, so the choice can say so before
 * it is made rather than after.
 */
export function countLike(
  txn: InterpretedTransaction,
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): number {
  const key = likeKey(txn, registry);
  return transactions.filter((row) => likeKey(row, registry) === key).length;
}

/**
 * Every key a verdict on this movement could be filed under, in the order they win: the
 * one row first because it was the more deliberate thing to say, then the payer it now
 * belongs to, then the wording before any merge, then the wording before words were
 * sorted. Taking a verdict back has to clear all of them or it comes straight back.
 */
export function verdictKeysFor(
  txn: InterpretedTransaction,
  registry: AccountRegistry = {},
): string[] {
  return [
    oneKey(txn, registry),
    likeKey(txn, registry),
    rawLikeKey(txn, registry),
    legacyLikeKey(txn, registry),
  ];
}

/**
 * Writes each verdict onto the movements it settles, so every total, chart and card reads
 * it without being handed the record. A verdict on the one row wins over a verdict on
 * everything like it, because it was the more deliberate thing to say.
 */
export function applyVerdicts(
  transactions: InterpretedTransaction[],
  verdicts: Verdicts = {},
  registry: AccountRegistry = {},
): InterpretedTransaction[] {
  if (Object.keys(verdicts).length === 0) {
    return transactions.some((txn) => txn.verdict)
      ? transactions.map((txn) => withoutVerdict(txn))
      : transactions;
  }

  return transactions.map((txn) => {
    const found = verdictKeysFor(txn, registry)
      .map((key) => verdicts[key])
      .find(Boolean);
    if (!found) return txn.verdict ? withoutVerdict(txn) : txn;
    // The verdict sets the type as well as being recorded, because a person saying
    // "borrowed money" is saying what kind of movement this is, and every total downstream
    // reads the type rather than the record.
    const type = typeForReason(found.because);
    if (same(txn.verdict, found) && txn.type === type) return txn;
    return { ...txn, verdict: found, type, decidedBy: "said" };
  });
}

/**
 * The wording that identifies a movement, tidied so the same purchase written twice by
 * one bank reads as one thing. Reference numbers differ on rows that mean the same, so
 * anything carrying a digit is dropped.
 *
 * The words are sorted, because where a bank puts a name is not information. Medicare
 * pays the same practice as "MCARE BENEFITS STEVEN OH" and as "STEVEN OH MCARE BENEFITS",
 * and reading those as two payers splits a year of billing in half. Sorting cannot join
 * two payers that are really different, because it leaves the words themselves untouched.
 */
export function wordsOf(txn: InterpretedTransaction): string[] {
  const text = (txn.description?.trim() || txn.merchant).toLowerCase();
  return [...new Set(text.split(/[^a-z]+/).filter((word) => word.length >= 3))].sort();
}

function wording(txn: InterpretedTransaction): string {
  const words = wordsOf(txn);
  // Nothing but reference numbers: fall back to the merchant so a key still means
  // something rather than collapsing every such row into one.
  return words.length > 0 ? words.join(" ") : txn.merchant.toLowerCase();
}

/** The old wording, in the order the bank wrote it. Only for finding what it filed. */
function asWritten(txn: InterpretedTransaction): string {
  const text = (txn.description?.trim() || txn.merchant).toLowerCase();
  const words = text.split(/[^a-z]+/).filter((word) => word.length >= 3);
  return words.length > 0 ? words.join(" ") : txn.merchant.toLowerCase();
}

function same(held: Verdict | undefined, next: Verdict): boolean {
  return held?.counts === next.counts && held.because === next.because && held.at === next.at;
}

/**
 * Taking a verdict back has to put the type back too, or the movement keeps the shape the
 * person gave it after they have said to stop. The category is what the reader worked out
 * on its own, so asking it again is the honest way to get there.
 */
function withoutVerdict(txn: InterpretedTransaction): InterpretedTransaction {
  const forgotten = { ...txn, type: typeForCategory(txn.categoryKey, txn.amount) };
  delete forgotten.verdict;
  return forgotten;
}
