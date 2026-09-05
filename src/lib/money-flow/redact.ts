/**
 * What is safe to send to a model, and what never leaves.
 *
 * A statement descriptor is not a merchant name. `Jordan Lee H4756108521` and
 * `MC BBS878 5550001X MCARE BENEFITS JORDAN LEE` and `Online C1828652469 Linked Acc Trns
 * Lee Jl` are all real rows from the sample statements, and between them they carry the
 * account holder's name, another person's name, and three account fragments. None of that
 * helps a model decide whether something is groceries, and all of it is the person's.
 *
 * Two passes remove it, and both are about *what a word is doing* rather than about
 * matching a list of names — a list would need the person's name in it, which is the thing
 * we are trying not to hold.
 *
 * 1. Anything carrying a digit goes. Reference numbers, BSBs, card fragments and biller
 *    codes all do; merchant names almost never do.
 * 2. Anything that turns up all over the ledger goes. A merchant appears on the rows it
 *    appears on; the account holder's name appears on hundreds. Measured over the sample
 *    statements the two are far apart and the gap is wide: "jordan" 20.0%, "benefits"
 *    11.7%, "mcare" 10.1%, then nothing until "woolworths" 5.0% and "zambrero" 3.0%.
 *
 * The same measurement is what `refunds.ts` uses to decide which shared word means two
 * movements are related. It is the same fact about statements read for a different purpose.
 */

import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * A word on more than this share of the ledger is telling us about the person, not about
 * the shop. Matches the threshold `refunds.ts` pairs on, and for the same measured reason.
 */
const EVERYWHERE = 0.08;

/**
 * A word has to be on more rows than this before its share means anything at all, so a
 * ledger of six movements does not decide that every word in it identifies somebody.
 */
const TOO_FEW_TO_JUDGE = 2;

/** Bank furniture. Says nothing about what was bought and nothing about who bought it. */
const FURNITURE = new Set([
  "aus", "australia", "bpay", "card", "cash", "credit", "debit", "deposit", "direct",
  "eftpos", "from", "internal", "ltd", "online", "osko", "payid", "payment", "pending",
  "pty", "purchase", "receipt", "recieved", "received", "ref", "tfr", "transaction",
  "transfer", "value", "visa", "withdrawal", "xfer",
]);

/** Enough to recognise a shop by. Anything longer is reference noise the reader kept. */
const MOST_WORDS_WORTH_SENDING = 8;

/**
 * The words that identify the person rather than a merchant, worked out from the ledger
 * itself so no list of names is ever held.
 */
export function personalWords(transactions: InterpretedTransaction[]): Set<string> {
  const seen = new Map<string, number>();
  for (const txn of transactions) {
    for (const word of new Set(wordsOf(txn))) seen.set(word, (seen.get(word) ?? 0) + 1);
  }

  const ceiling = transactions.length * EVERYWHERE;
  return new Set(
    [...seen].filter(([, count]) => count > TOO_FEW_TO_JUDGE && count > ceiling).map(([word]) => word),
  );
}

/**
 * A movement's wording, with everything that identifies a person or an account taken out.
 *
 * Returns an empty string when nothing survives, which is the right answer for a row whose
 * whole descriptor was a reference number: there is nothing to ask a model about.
 */
export function redactDescriptor(text: string, personal: Set<string> = new Set()): string {
  return tokens(text)
    .filter((word) => !personal.has(word))
    .slice(0, MOST_WORDS_WORTH_SENDING)
    .join(" ");
}

/** The safe wording for one movement, from everything the statement wrote about it. */
export function redactMovement(txn: InterpretedTransaction, personal: Set<string> = new Set()): string {
  return redactDescriptor(`${txn.merchant} ${txn.description ?? ""}`, personal);
}

/**
 * One merchant's identity, with the parts that differ row to row taken off.
 *
 * A bank writes the same payee three times as `Casey Lee Offset J8243077379`,
 * `Casey Lee Offset M7022577125` and `Casey Lee Offset T9236586400`. Read literally those
 * are three merchants, which means three questions in the review queue and three separate
 * things to teach the app about one payee. Stripping what carries a digit leaves one.
 *
 * Deliberately *not* aggressive beyond that. Two PayPal charges stay two merchants,
 * because the only thing distinguishing them is the seller's name and collapsing on the
 * processor would file a Google subscription and a Bunnings order in the same place.
 *
 * Falls back to the merchant as written when nothing survives — a payee called only
 * "Payment" is a poor identity but it is the one the statement gave, and an empty key
 * would gather every such row in the ledger into one.
 */
export function merchantKey(txn: Pick<InterpretedTransaction, "merchant">): string {
  const stripped = tokens(txn.merchant).join(" ");
  return stripped || txn.merchant.trim().toLowerCase();
}

function wordsOf(txn: InterpretedTransaction): string[] {
  return tokens(`${txn.merchant} ${txn.description ?? ""}`);
}

/**
 * Letters only, so every token carrying a digit is gone before anything else looks at it —
 * which is what takes the account fragments out of `Jordan Lee H4756108521`.
 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2 && !FURNITURE.has(word));
}
