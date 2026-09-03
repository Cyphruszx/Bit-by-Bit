/**
 * How often a stream of money arrives, and what it is worth a week.
 *
 * A person knows what they earn. When the app's figure disagrees, the useful question is
 * not "which is right" but "how much is the difference" — and the only way to answer that
 * is to know the rate. $5,409 means nothing; two weeks of billing means everything,
 * because a person can say straight away whether two weeks is plausible.
 *
 * The rate is measured over the stretches a stream was actually running. A month off does
 * not make someone's practice smaller, so a break is set aside rather than averaged in.
 *
 * A break is also worth knowing about on its own — but only a person can say what it
 * means. What the ledger can add is whether the rest of the account kept moving through
 * it: a stream stopping while its account carries on is a pause in the work, while a whole
 * account falling silent when the others did not is a statement that may be missing.
 */

import { accountIdOf, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { roundMoney } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { likeKey } from "@/lib/money-flow/verdicts";

const DAY = 86400000;
const WEEK = 7;

/** Below this a stream has no rhythm to speak of, only a handful of arrivals. */
const ENOUGH_PAYMENTS = 8;
const ENOUGH_WEEKS = 8;

/**
 * A silence worth calling a break. Measured against the stream's own habit rather than a
 * calendar, so a fortnightly wage and a daily benefit are both judged on their own terms.
 *
 * Over the sample statements this separates the cases cleanly. Medicare pays most days
 * (median gap 1 day) and its silences run 7, 8, 15 and 29 days: the last two are a break
 * and the first two are a long weekend. Interest arrives monthly (median 31) with gaps of
 * 30 to 33, and none of those is a break, which a plain "two weeks of silence" rule would
 * get wrong every month.
 */
const BREAK_DAYS = 14;
const BREAK_MULTIPLE = 5;

export type RhythmBreak = {
  /** The last arrival before the silence, and the first after it. */
  after: string;
  until: string;
  days: number;
  /** What the silence is worth at this stream's rate, which is the number to argue with. */
  worth: number;
  /**
   * Whether the account carried on through the silence. A stream stopping while its
   * account still moves is the work pausing; a whole account going quiet while others
   * carry on is a statement that may be missing.
   */
  accountKeptMoving: boolean;
  reading: "paused" | "may-be-missing";
};

export type Rhythm = {
  key: string;
  label: string;
  account: string;
  count: number;
  total: number;
  first: string;
  last: string;
  /** The gap a person would call normal for this stream, in days. */
  everyDays: number;
  /** Weeks the stream was actually running, breaks set aside. */
  weeksRunning: number;
  perWeek: number;
  perFortnight: number;
  breaks: RhythmBreak[];
};

export type RhythmOptions = {
  registry?: AccountRegistry;
  /** Streams smaller than this have no rhythm worth reporting. */
  minPayments?: number;
};

/**
 * Every stream of money in with enough history to have a habit, richest first. Only money
 * in: what a person earns is the thing they can check against an outside figure, and a
 * year of shopping has no rhythm to break.
 */
export function incomeRhythms(
  transactions: InterpretedTransaction[],
  options: RhythmOptions = {},
): Rhythm[] {
  const registry = options.registry ?? {};
  const minPayments = options.minPayments ?? ENOUGH_PAYMENTS;

  const streams = new Map<string, InterpretedTransaction[]>();
  for (const txn of transactions) {
    if (txn.amount <= 0 || txn.transferPair || txn.refundPair) continue;
    const key = likeKey(txn, registry);
    streams.set(key, [...(streams.get(key) ?? []), txn]);
  }

  const rhythms: Rhythm[] = [];
  for (const [key, rows] of streams) {
    if (rows.length < minPayments) continue;
    const rhythm = rhythmOf(key, rows, transactions, registry);
    if (rhythm) rhythms.push(rhythm);
  }

  return rhythms.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function rhythmOf(
  key: string,
  rows: InterpretedTransaction[],
  everything: InterpretedTransaction[],
  registry: AccountRegistry,
): Rhythm | null {
  const days = [...new Set(rows.map((row) => row.dateIso))].sort();
  const first = days[0];
  const last = days[days.length - 1];
  const spanWeeks = daysBetween(first, last) / WEEK;
  if (spanWeeks < ENOUGH_WEEKS) return null;

  const gaps = days.slice(1).map((day, index) => daysBetween(days[index], day));
  const everyDays = median(gaps);
  const account = accountIdOf(rows[0], registry);
  const inAccount = everything.filter((txn) => accountIdOf(txn, registry) === account);

  const total = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
  const breaks: RhythmBreak[] = [];
  let quietDays = 0;

  for (const [index, gap] of gaps.entries()) {
    if (!isBreak(gap, everyDays)) continue;
    const after = days[index];
    const until = days[index + 1];
    // The silence itself, not the ordinary wait either side of it.
    const silence = gap - everyDays;
    quietDays += silence;
    const kept = inAccount.some((txn) => txn.dateIso > after && txn.dateIso < until);
    breaks.push({
      after,
      until,
      days: gap,
      worth: 0,
      accountKeptMoving: kept,
      reading: kept ? "paused" : "may-be-missing",
    });
  }

  // The rate is what the stream does when it is running, so the silences come out first.
  const weeksRunning = Math.max((daysBetween(first, last) - quietDays) / WEEK, 1);
  const perWeek = roundMoney(total / weeksRunning);

  return {
    key,
    label: rows[0].description?.trim() || rows[0].merchant,
    account,
    count: rows.length,
    total,
    first,
    last,
    everyDays,
    weeksRunning: Math.round(weeksRunning * 10) / 10,
    perWeek,
    perFortnight: roundMoney(perWeek * 2),
    breaks: breaks.map((found) => ({
      ...found,
      worth: roundMoney((perWeek * (found.days - everyDays)) / WEEK),
    })),
  };
}

/**
 * A silence long enough to be worth money, and long enough to be unlike this stream. Both
 * are needed: two weeks is nothing to a monthly payment, and five times the usual gap is
 * nothing to a daily one.
 */
function isBreak(gap: number, everyDays: number): boolean {
  return gap >= BREAK_DAYS && gap >= Math.max(everyDays, 1) * BREAK_MULTIPLE;
}

/**
 * How much of a stream a sum of money is. The point of knowing a rate: a person cannot
 * say whether $5,409.10 is right, but can say instantly whether two weeks is.
 */
export function weeksWorth(rhythm: Rhythm, amount: number): number {
  if (rhythm.perWeek <= 0) return 0;
  return Math.round((Math.abs(amount) / rhythm.perWeek) * 100) / 100;
}

/** The median, so one long silence does not become the stream's habit. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}
