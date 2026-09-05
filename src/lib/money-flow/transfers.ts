import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/accounts";
import { institutionOf, type InstitutionOverrides } from "@/lib/money-flow/institution";
import { typeForCategory } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/** Amounts are money, so equality is to the cent and nothing finer. */
const CENT = 0.005;
const DAY = 86400000;

export type TransferPair = {
  debit: InterpretedTransaction;
  credit: InterpretedTransaction;
  fromAccount: string;
  toAccount: string;
  /** Calendar days the credit lagged the debit. */
  lagDays: number;
  sameInstitution: boolean;
};

/**
 * A debit whose candidates were not alike, so pairing one would have been a guess.
 * Left in the totals and surfaced, rather than decided quietly.
 */
export type ContestedTransfer = {
  debit: InterpretedTransaction;
  candidates: InterpretedTransaction[];
};

export type TransferMatch = {
  pairs: TransferPair[];
  contested: ContestedTransfer[];
  /** Every leg of a matched pair, by movement id. */
  matched: Set<string>;
};

export type MatchOptions = {
  /** Business days a credit may lag its debit inside one bank. */
  withinBank?: number;
  /** And between two, where the money travels over slower rails. */
  acrossBanks?: number;
  institutions?: InstitutionOverrides;
  /** Accounts a person has named or merged, so a merged pair stops looking like two. */
  accounts?: AccountRegistry["names"];
};

export const EMPTY_MATCH: TransferMatch = { pairs: [], contested: [], matched: new Set() };

/**
 * Pairs a debit with the credit that is the same money arriving in another of the
 * person's accounts. The bank's own wording is deliberately not consulted: NAB calls
 * 212 movements a transfer and only 54 of them are, so a pair has to be found rather
 * than believed.
 *
 * Runs over the whole ledger every time and claims nothing twice, so importing another
 * statement re-decides every pair and reaches the same answer from the same movements.
 */
export function matchTransfers(
  transactions: InterpretedTransaction[],
  options: MatchOptions = {},
): TransferMatch {
  const withinBank = options.withinBank ?? 1;
  const acrossBanks = options.acrossBanks ?? 2;
  const overrides = options.institutions ?? {};

  const registry: AccountRegistry = { institutions: overrides, ...(options.accounts ? { names: options.accounts } : {}) };
  const account = new Map(transactions.map((txn) => [txn.id, accountIdOf(txn, registry)]));
  const bank = new Map(transactions.map((txn) => [txn.id, institutionOf(txn, overrides)]));

  const names = new Set(
    [...account.values()].map(accountName).filter((name) => name.length >= 3),
  );
  // Indexed by amount, because equal amounts are the only pairs worth considering and
  // a ledger holds years of movements a summary should not have to walk twice.
  const byAmount = new Map<string, InterpretedTransaction[]>();
  for (const credit of transactions.filter((txn) => txn.amount > 0).sort(byDateThenId)) {
    const key = amountKey(credit.amount);
    byAmount.set(key, [...(byAmount.get(key) ?? []), credit]);
  }
  const debits = transactions.filter((txn) => txn.amount < 0).sort(byDateThenId);

  const claimed = new Set<string>();
  const pairs: TransferPair[] = [];
  const contested: ContestedTransfer[] = [];

  for (const debit of debits) {
    const candidates = (byAmount.get(amountKey(-debit.amount)) ?? []).filter((credit) => {
      if (claimed.has(credit.id)) return false;
      // The same money cannot leave and arrive in the same account.
      if (account.get(credit.id) === account.get(debit.id)) return false;
      // A credit may lag its debit while the money settles, but never precede it.
      if (credit.dateIso < debit.dateIso) return false;
      const sameBank = bank.get(credit.id) === bank.get(debit.id);
      return businessDaysBetween(debit.dateIso, credit.dateIso) <= (sameBank ? withinBank : acrossBanks);
    });

    if (candidates.length === 0) continue;

    // Nearest in time wins. Counted in calendar days, because a bank that posts on a
    // Saturday would otherwise look no further away than one that posted on the Friday.
    const nearest = Math.min(...candidates.map((credit) => calendarDaysBetween(debit.dateIso, credit.dateIso)));
    const winners = candidates.filter(
      (credit) => calendarDaysBetween(debit.dateIso, credit.dateIso) === nearest,
    );

    const settled = settle(winners, account.get(debit.id) ?? "", names);
    if (settled.length > 1 && !settled.every((credit) => alike(credit, settled[0]))) {
      contested.push({ debit, candidates: settled });
      continue;
    }

    const credit = settled[0];
    claimed.add(credit.id);
    pairs.push({
      debit,
      credit,
      fromAccount: account.get(debit.id) ?? "",
      toAccount: account.get(credit.id) ?? "",
      lagDays: nearest,
      sameInstitution: bank.get(credit.id) === bank.get(debit.id),
    });
  }

  return {
    pairs,
    contested,
    matched: new Set(pairs.flatMap((pair) => [pair.debit.id, pair.credit.id])),
  };
}

/**
 * Where candidates arrived on the same day, the statement sometimes says which account
 * the money came from — Up writes "Transfer From Save!!" on the leg a saver sent. That
 * wording is never taken as proof that a movement is a transfer, only as a way of
 * telling two otherwise identical candidates apart: one that names the account being
 * matched is preferred, and one that names a different account of the person's is set
 * aside for that account's own debit.
 */
function settle(
  candidates: InterpretedTransaction[],
  debitAccount: string,
  names: Set<string>,
): InterpretedTransaction[] {
  if (candidates.length < 2) return candidates;
  const wanted = accountName(debitAccount);

  const naming = candidates.filter((credit) => mentions(credit, wanted));
  if (naming.length === 1) return naming;

  const others = [...names].filter((name) => name !== wanted);
  const neutral = candidates.filter((credit) => !others.some((name) => mentions(credit, name)));
  return neutral.length === 1 ? neutral : candidates;
}

/** "Up · Save!!" is called "Save!!" on the movements that mention it. */
function accountName(id: string): string {
  return id.split(" · ").pop() ?? id;
}

function mentions(txn: InterpretedTransaction, name: string): boolean {
  if (name.length < 3) return false;
  return (txn.description?.trim() || txn.merchant).toLowerCase().includes(name.toLowerCase());
}

/**
 * Two candidates a person could not tell apart either. Choosing between them changes
 * no total, so refusing to choose would only leave real transfers counted as income
 * and spending.
 */
function alike(a: InterpretedTransaction, b: InterpretedTransaction): boolean {
  return (
    a.dateIso === b.dateIso &&
    Math.abs(a.amount - b.amount) < CENT &&
    (a.description?.trim() || a.merchant) === (b.description?.trim() || b.merchant)
  );
}

/**
 * Writes each pair onto its two legs, so every total, chart and card downstream reads
 * the same verdict without being handed the match. Legs of a pair that no longer holds
 * — a statement removed, an account renamed — lose the mark rather than keeping a
 * decision nothing supports any more.
 */
export function markTransferLegs(
  transactions: InterpretedTransaction[],
  options: MatchOptions = {},
): InterpretedTransaction[] {
  const match = matchTransfers(transactions, options);
  const pairOf = new Map<string, string>();
  for (const pair of match.pairs) {
    const id = `${pair.debit.id}~${pair.credit.id}`;
    pairOf.set(pair.debit.id, id);
    pairOf.set(pair.credit.id, id);
  }

  // Finding the other leg is the only thing that proves money moved between the person's
  // own accounts, so this is the only place `moved` is ever written. A bank's own wording
  // gets no vote: NAB calls 212 movements a transfer and 54 of them are.
  return transactions.map((txn) => {
    const pair = pairOf.get(txn.id);
    if (pair) {
      if (txn.transferPair === pair && txn.type === "moved") return txn;
      return { ...txn, transferPair: pair, type: "moved" as const, decidedBy: "paired" as const };
    }
    if (!txn.transferPair) return txn;
    // A pair that no longer holds — the other account's statement was removed — has to
    // give the type back as well as the mark, or the money stays invisible on the evidence
    // of something that is no longer there.
    const forgotten = { ...txn, type: typeForCategory(txn.categoryKey, txn.amount) };
    delete forgotten.transferPair;
    return forgotten;
  });
}

export function withoutMatchedLegs(
  transactions: InterpretedTransaction[],
  match: TransferMatch,
): InterpretedTransaction[] {
  return transactions.filter((txn) => !match.matched.has(txn.id));
}

/** Money to the cent, so equal amounts land in the same bucket. */
function amountKey(amount: number): string {
  return Math.round(Math.abs(amount) * 100).toString();
}

/** Ordered so the same movements always produce the same pairs. */
function byDateThenId(a: InterpretedTransaction, b: InterpretedTransaction): number {
  return a.dateIso.localeCompare(b.dateIso) || a.id.localeCompare(b.id);
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

/**
 * Weekends are not counted, because a Friday payment landing Monday waited one working
 * day rather than three. Only the days between are weighed, so a Saturday arrival is
 * still the same day it was sent.
 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const total = calendarDaysBetween(fromIso, toIso);
  if (total <= 0) return total;
  let days = 0;
  for (let step = 1; step <= total; step += 1) {
    const day = new Date(Date.parse(`${fromIso}T00:00:00Z`) + step * DAY).getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}
