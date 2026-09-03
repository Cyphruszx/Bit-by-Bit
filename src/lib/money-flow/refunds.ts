/**
 * Pairs a credit with the payment it reverses.
 *
 * A refund is not income. Money you get back because a shop reversed a charge never
 * entered the household, and counting it as income inflates earnings and leaves the
 * original payment standing as spending that never really happened.
 *
 * What a bank calls a refund is not enough to go on. NAB files a year of Medicare
 * benefits under the category "Refund" — $120,844.20 across the sample statements — and
 * that is a practice's revenue, not money coming back. So a refund is only ever
 * recognised by finding the payment it reverses: the same amount, in the same account,
 * after a debit that names the same distinctive thing. Nothing matched means nothing
 * changes, which leaves real revenue counted as the income it is.
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { calendarDaysBetween } from "@/lib/money-flow/transfers";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const CENT = 0.005;

/** A shop can take a couple of months to reverse a charge, but not a year. */
const DEFAULT_WINDOW_DAYS = 90;

/**
 * A word shared by more than this share of the ledger says nothing about which two
 * movements belong together: the person's own name is on hundreds of rows, and so is the
 * benefit their practice bills every week.
 *
 * Measured over the sample statements, where the words to reject and the words to keep
 * fall either side of a wide gap: "jordan" 20.0%, "benefits" 11.7%, "mcare" 10.1%, then
 * nothing until "woolworths" 5.0%, "zambrero" 3.0%, "optical" 1.0%, "kmart" 0.2%.
 */
const COMMON_ENOUGH_TO_MEAN_NOTHING = 0.08;

/** Bank furniture. Present on movements that have nothing to do with each other. */
const NOISE = new Set([
  "account", "aus", "australia", "bpay", "card", "cash", "credit", "debit", "deposit",
  "direct", "eftpos", "from", "internal", "ltd", "online", "osko", "payid", "payment",
  "pending", "pty", "purchase", "rebate", "receipt", "recieved", "received", "reversal",
  "refund", "transaction", "transfer", "value", "visa", "withdrawal",
]);

export type RefundPair = {
  /** The payment that was reversed. */
  payment: InterpretedTransaction;
  /** The money coming back. */
  refund: InterpretedTransaction;
  account: string;
  /** Calendar days the money took to come back. */
  lagDays: number;
  /** The word that tied the two together, so a wrong pair can be argued with. */
  because: string;
};

export type RefundMatch = {
  pairs: RefundPair[];
  /** Every leg of a matched pair, by movement id. */
  matched: Set<string>;
};

export type RefundOptions = {
  windowDays?: number;
  accounts?: AccountRegistry["names"];
  institutions?: AccountRegistry["institutions"];
};

export const EMPTY_REFUND_MATCH: RefundMatch = { pairs: [], matched: new Set() };

/**
 * Runs over the whole ledger and claims nothing twice, so importing another statement
 * re-decides every pair and reaches the same answer from the same movements.
 *
 * Legs already settled as a transfer are left alone: money that went to another of the
 * person's accounts has been accounted for once already.
 */
export function matchRefunds(
  transactions: InterpretedTransaction[],
  options: RefundOptions = {},
): RefundMatch {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const registry: AccountRegistry = {
    ...(options.accounts ? { names: options.accounts } : {}),
    ...(options.institutions ? { institutions: options.institutions } : {}),
  };

  const open = transactions.filter((txn) => !txn.transferPair);
  const distinctive = distinctiveWords(transactions);
  const account = new Map(open.map((txn) => [txn.id, accountIdOf(txn, registry)]));
  const words = new Map(open.map((txn) => [txn.id, meaningfulWords(txn, distinctive)]));

  // Indexed by amount and account, because a refund returns exactly what was paid, to
  // the card that paid it, and a ledger holds years of movements to walk otherwise.
  const payments = new Map<string, InterpretedTransaction[]>();
  for (const debit of open.filter((txn) => txn.amount < 0).sort(byDateThenId)) {
    const key = bucket(account.get(debit.id) ?? "", debit.amount);
    payments.set(key, [...(payments.get(key) ?? []), debit]);
  }

  const claimed = new Set<string>();
  const pairs: RefundPair[] = [];

  for (const refund of open.filter((txn) => txn.amount > 0).sort(byDateThenId)) {
    const shared = words.get(refund.id) ?? new Set<string>();
    if (shared.size === 0) continue;

    const candidates = (payments.get(bucket(account.get(refund.id) ?? "", refund.amount)) ?? [])
      .filter((payment) => {
        if (claimed.has(payment.id)) return false;
        // Money comes back after it went out, never before.
        const lag = calendarDaysBetween(payment.dateIso, refund.dateIso);
        if (lag < 0 || lag > windowDays) return false;
        return [...(words.get(payment.id) ?? [])].some((word) => shared.has(word));
      });

    if (candidates.length === 0) continue;

    // The most recent payment before the money came back, which is the one a shop
    // reversing a charge would have been reversing.
    const payment = candidates.reduce((nearest, next) =>
      next.dateIso > nearest.dateIso || (next.dateIso === nearest.dateIso && next.id > nearest.id)
        ? next
        : nearest,
    );
    const because = [...(words.get(payment.id) ?? [])].find((word) => shared.has(word)) ?? "";

    claimed.add(payment.id);
    pairs.push({
      payment,
      refund,
      account: account.get(refund.id) ?? "",
      lagDays: calendarDaysBetween(payment.dateIso, refund.dateIso),
      because,
    });
  }

  return {
    pairs,
    matched: new Set(pairs.flatMap((pair) => [pair.payment.id, pair.refund.id])),
  };
}

/**
 * Writes each pair onto its two legs, so every total, chart and card downstream reads the
 * same verdict. Legs of a pair that no longer holds lose the mark rather than keeping a
 * decision nothing supports any more.
 */
export function markRefundLegs(
  transactions: InterpretedTransaction[],
  options: RefundOptions = {},
): InterpretedTransaction[] {
  const match = matchRefunds(transactions, options);
  const pairOf = new Map<string, string>();
  for (const pair of match.pairs) {
    const id = `${pair.payment.id}~${pair.refund.id}`;
    pairOf.set(pair.payment.id, id);
    pairOf.set(pair.refund.id, id);
  }

  return transactions.map((txn) => {
    const pair = pairOf.get(txn.id);
    if (pair) return txn.refundPair === pair ? txn : { ...txn, refundPair: pair };
    if (!txn.refundPair) return txn;
    const forgotten = { ...txn };
    delete forgotten.refundPair;
    return forgotten;
  });
}

/**
 * The words that actually pick a movement out of the ledger. A word on one row in twenty
 * is furniture — a surname, a bank's own wording, a benefit billed every week — and two
 * movements sharing only furniture are not related.
 */
export function distinctiveWords(transactions: InterpretedTransaction[]): Set<string> {
  const seen = new Map<string, number>();
  for (const txn of transactions) {
    for (const word of new Set(wordsOf(txn))) seen.set(word, (seen.get(word) ?? 0) + 1);
  }

  const ceiling = transactions.length * COMMON_ENOUGH_TO_MEAN_NOTHING;
  return new Set(
    // A word on one or two rows in the whole ledger is distinctive however small the
    // ledger is, which a share on its own cannot say.
    [...seen].filter(([, count]) => count <= 2 || count <= ceiling).map(([word]) => word),
  );
}

function meaningfulWords(txn: InterpretedTransaction, distinctive: Set<string>): Set<string> {
  return new Set(wordsOf(txn).filter((word) => distinctive.has(word)));
}

/**
 * Words worth comparing: no bank furniture, and nothing carrying a digit, because a
 * statement's reference numbers differ on the very rows that belong together.
 */
function wordsOf(txn: InterpretedTransaction): string[] {
  const text = `${txn.description?.trim() || ""} ${txn.merchant}`.toLowerCase();
  return text
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !NOISE.has(word));
}

function bucket(account: string, amount: number): string {
  return `${account}|${Math.round(Math.abs(amount) * 100)}`;
}

function byDateThenId(a: InterpretedTransaction, b: InterpretedTransaction): number {
  return a.dateIso.localeCompare(b.dateIso) || a.id.localeCompare(b.id);
}

/** Amounts are money, so equality is to the cent and nothing finer. */
export function sameAmount(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < CENT;
}
