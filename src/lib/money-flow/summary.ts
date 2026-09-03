import { formatAud } from "@/lib/format";
import { formatDisplayDate, roundMoney } from "@/lib/money-flow/parse-values";
import { monthLabelFromKey } from "@/lib/money-flow/savings";
import { accountIdOf, namesItsOwnAccount, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { primaryTag, subTags, tagsOf } from "@/lib/money-flow/tags";

import type { CategorySpend, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

export type TagFlowDirection = "out" | "in";
export const NO_SUB_TAG = "No sub-tag";

/** A tag's net position: `amount` is signed, positive for money in and negative for money out. */
export type TagFlowRow = CategorySpend & {
  income: number;
  spending: number;
};

export type TagFlowSeries = {
  rows: TagFlowRow[];
  level: "primary" | "sub";
  income: number;
  spending: number;
  net: number;
  parent: string | null;
};

export type FlowOverTimePoint = {
  key: string;
  label: string;
  income: number;
  spending: number;
  /** Money in minus money out for this bucket alone. */
  net: number;
  /** Every bucket's net added up to here, so the line holds its level between movements. */
  runningNet: number;
};

/**
 * Money in and money out, with the person's own transfers counted once.
 *
 * A movement leaves income and spending only when the other leg of the transfer was
 * found in another account — markTransferLegs decides that over the whole ledger, so a
 * transfer sent in January and received in February is still one movement of the same
 * money. A bank writing "transfer" on a movement is not enough on its own.
 */
export function summarizeMoneyFlow(transactions: InterpretedTransaction[]): MoneyFlowSummary {
  const counted = countedMovements(transactions);
  const income = roundMoney(counted.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0));
  const spending = roundMoney(
    counted.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const cashIn = roundMoney(
    transactions.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0),
  );
  const cashOut = roundMoney(
    transactions.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  // One side of each pair held here: the money that moved, not the two rows for it.
  const paired = transactions.filter((txn) => !counted.includes(txn));
  const transfers = roundMoney(
    paired.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const unmatchedInternal = roundMoney(
    counted.filter((txn) => txn.type === "transfer").reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const refunds = roundMoney(
    transactions.filter((txn) => txn.type === "refund").reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const net = roundMoney(income - spending);
  const cashNet = roundMoney(cashIn - cashOut);
  const categories = spendByTags(transactions);

  return {
    income,
    spending,
    net,
    cashIn,
    cashOut,
    cashNet,
    transfers,
    unmatchedInternal,
    refunds,
    transactionCount: transactions.length,
    categories,
    periodLabel: periodLabel(transactions),
    insights: insights(transactions, { income, spending, net, cashNet, transfers, unmatchedInternal, categories }),
  };
}

/**
 * The movements a total should count, which is everything except a transfer whose two
 * legs are both in front of us. One leg on its own still counts: seen from inside NAB
 * alone, money sent to Up did leave, and the NAB card has to tie to NAB's statement.
 * Only a view holding both accounts can see that the money never left the household.
 */
export function countedMovements(transactions: InterpretedTransaction[]): InterpretedTransaction[] {
  const legs = new Map<string, number>();
  for (const txn of transactions) {
    for (const pair of [txn.transferPair, txn.refundPair]) {
      if (pair) legs.set(pair, (legs.get(pair) ?? 0) + 1);
    }
  }
  // A pair only cancels when both its legs are in the set being summarised: one account's
  // own figures still show money leaving it for another, and a refund still counts as
  // money in when the payment it reverses is not in view.
  const settled = (txn: InterpretedTransaction) =>
    [txn.transferPair, txn.refundPair].some((pair) => pair && (legs.get(pair) ?? 0) >= 2);
  // A person saying a movement is not their own money in or out is the last word: they
  // can see what the statements cannot say, and nothing here should argue with them.
  return transactions.filter((txn) => txn.verdict?.counts !== false && !settled(txn));
}

export function isOutflow(txn: InterpretedTransaction): boolean {
  return txn.amount < 0 && !txn.transferPair;
}

export function isInflow(txn: InterpretedTransaction): boolean {
  return txn.amount > 0 && !txn.transferPair;
}

export function spendByTags(transactions: InterpretedTransaction[]): CategorySpend[] {
  return amountByPrimaryTags(transactions, "out");
}

export function amountByPrimaryTags(
  transactions: InterpretedTransaction[],
  direction: TagFlowDirection = "out",
): CategorySpend[] {
  return aggregateByTag(directed(transactions, direction), (txn) => primaryTag(txn));
}

export function chartTagFlowSeries(transactions: InterpretedTransaction[], selectedTag: string): TagFlowSeries {
  const rows = countedMovements(transactions).filter((txn) => txn.amount !== 0);
  const selectedIsPrimary = rows.some((txn) => primaryTag(txn) === selectedTag);

  if (selectedTag !== "All" && selectedIsPrimary) {
    const underPrimary = rows.filter((txn) => primaryTag(txn) === selectedTag);
    const hasSub = underPrimary.some((txn) => subTags(txn).length > 0);
    return {
      rows: netByTag(underPrimary, hasSub ? (txn) => subTags(txn)[0] ?? NO_SUB_TAG : (txn) => primaryTag(txn)),
      level: hasSub ? "sub" : "primary",
      ...flowTotals(underPrimary),
      parent: selectedTag,
    };
  }

  const filtered = selectedTag === "All" ? rows : rows.filter((txn) => tagsOf(txn).includes(selectedTag));
  return {
    rows: netByTag(filtered, (txn) => primaryTag(txn)),
    level: "primary",
    ...flowTotals(filtered),
    parent: null,
  };
}

/**
 * Buckets money in and out by day so each movement lands on its own point, falling back to months
 * only once the range is too long to plot daily. Every bucket between the first and last is emitted,
 * including quiet ones: the chart spaces points evenly, so skipping one would draw its neighbours as
 * if they were consecutive.
 */
export function tagFlowOverTime(
  transactions: InterpretedTransaction[],
  selectedTag = "All",
): FlowOverTimePoint[] {
  const rows = countedMovements(transactions).filter(
    (txn) =>
      txn.amount !== 0 &&
      Boolean(txn.dateIso) &&
      (selectedTag === "All" || tagsOf(txn).includes(selectedTag)),
  );
  if (rows.length === 0) return [];

  const days = rows.map((txn) => txn.dateIso.slice(0, 10)).sort();
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const byDay = spanInDays(firstDay, lastDay) <= MAX_DAILY_SPAN;
  const totals = new Map<string, { income: number; spending: number }>();

  for (const txn of rows) {
    const key = txn.dateIso.slice(0, byDay ? 10 : 7);
    const entry = totals.get(key) ?? { income: 0, spending: 0 };
    if (txn.amount > 0) entry.income = roundMoney(entry.income + txn.amount);
    else entry.spending = roundMoney(entry.spending + Math.abs(txn.amount));
    totals.set(key, entry);
  }

  const keys = byDay
    ? daySpan(firstDay, lastDay)
    : monthSpan(firstDay.slice(0, 7), lastDay.slice(0, 7));

  let running = 0;
  return keys.map((key) => {
    const entry = totals.get(key) ?? { income: 0, spending: 0 };
    const net = roundMoney(entry.income - entry.spending);
    running = roundMoney(running + net);
    return {
      key,
      label: byDay ? formatDisplayDate(key) : monthLabelFromKey(key),
      income: entry.income,
      spending: entry.spending,
      net,
      runningNet: running,
    };
  });
}

/** Both spans are bounded so a malformed date can never spin the browser. */
const MAX_BUCKETS = 800;

/** A point per day keeps every movement visible; past this many days it collapses to months. */
const MAX_DAILY_SPAN = 400;

function spanInDays(first: string, last: string): number {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
}

function monthSpan(first: string, last: string): string[] {
  const [firstYear, firstMonth] = first.split("-").map(Number);
  const [lastYear, lastMonth] = last.split("-").map(Number);
  if (!firstYear || !firstMonth || !lastYear || !lastMonth) return [first];

  const keys: string[] = [];
  let year = firstYear;
  let month = firstMonth;
  while (keys.length < MAX_BUCKETS && (year < lastYear || (year === lastYear && month <= lastMonth))) {
    keys.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function daySpan(first: string, last: string): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [first];

  const keys: string[] = [];
  for (let day = start; day <= end && keys.length < MAX_BUCKETS; day += 86_400_000) {
    keys.push(new Date(day).toISOString().slice(0, 10));
  }
  return keys;
}

function flowTotals(transactions: InterpretedTransaction[]): { income: number; spending: number; net: number } {
  const income = roundMoney(transactions.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0));
  const spending = roundMoney(
    transactions.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  return { income, spending, net: roundMoney(income - spending) };
}

function netByTag(
  transactions: InterpretedTransaction[],
  keyOf: (txn: InterpretedTransaction) => string,
): TagFlowRow[] {
  const byTag = new Map<string, { income: number; spending: number }>();
  for (const txn of transactions) {
    const name = keyOf(txn);
    const entry = byTag.get(name) ?? { income: 0, spending: 0 };
    if (txn.amount > 0) entry.income = roundMoney(entry.income + txn.amount);
    else entry.spending = roundMoney(entry.spending + Math.abs(txn.amount));
    byTag.set(name, entry);
  }

  const totalAbs = [...byTag.values()].reduce((sum, entry) => sum + Math.abs(entry.income - entry.spending), 0);
  return [...byTag.entries()]
    .map(([name, entry]) => {
      const amount = roundMoney(entry.income - entry.spending);
      return {
        name,
        amount,
        income: entry.income,
        spending: entry.spending,
        share: totalAbs > 0 ? Math.round((Math.abs(amount) / totalAbs) * 100) : 0,
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.name.localeCompare(b.name));
}

function directed(transactions: InterpretedTransaction[], direction: TagFlowDirection): InterpretedTransaction[] {
  return countedMovements(transactions).filter((txn) => (direction === "out" ? txn.amount < 0 : txn.amount > 0));
}

function signedTotal(transactions: InterpretedTransaction[]): number {
  return roundMoney(transactions.reduce((sum, txn) => sum + Math.abs(txn.amount), 0));
}

function aggregateByTag(
  transactions: InterpretedTransaction[],
  keyOf: (txn: InterpretedTransaction) => string,
): CategorySpend[] {
  const total = signedTotal(transactions);
  const byTag = new Map<string, number>();
  for (const txn of transactions) {
    const name = keyOf(txn);
    const amount = Math.abs(txn.amount);
    byTag.set(name, roundMoney((byTag.get(name) ?? 0) + amount));
  }
  return [...byTag.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      share: total > 0 ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function uniqueTransactions(
  rows: InterpretedTransaction[],
  registry: AccountRegistry = {},
): InterpretedTransaction[] {
  // Two files can describe the same movement, but one file can also hold the same movement
  // twice and mean it: two identical purchases in a day, or a cent of interest paid into
  // each of eight savers. Counting how often a description has already appeared *within its
  // own file* tells them apart. A second copy of a file repeats occurrence 0 and is dropped,
  // while a genuine repeat is occurrence 1 and survives.
  //
  // The account is part of a movement's identity, but only when a statement actually named
  // one: an $86.40 shop on the same day in two named accounts is two payments, while two
  // statements that name no account are more likely one account downloaded twice over
  // overlapping periods, where the repeat is the same movement seen again.
  //
  // The account is asked for by the name it currently goes by, so saying two statements
  // are one account makes their overlap fold away without anything being re-imported.
  const withinFile = new Map<string, number>();
  const seen = new Set<string>();
  return rows.filter((row) => {
    const account = namesItsOwnAccount(row) ? accountIdOf(row, registry) : "";
    const body = `${account}|${row.dateIso}|${row.amount}|${row.merchant.toLowerCase()}`;
    const counter = `${row.sourceFile}|${body}`;
    const occurrence = withinFile.get(counter) ?? 0;
    withinFile.set(counter, occurrence + 1);
    const key = `${body}|${occurrence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function periodLabel(transactions: InterpretedTransaction[]): string {
  if (transactions.length === 0) return "No activity yet";
  const dates = transactions.map((txn) => txn.dateIso).sort();
  const first = transactions.find((txn) => txn.dateIso === dates[0]);
  const last = transactions.find((txn) => txn.dateIso === dates[dates.length - 1]);
  if (!first || !last) return "Interpreted activity";
  if (first.dateIso === last.dateIso) return first.date;
  return `${first.date} – ${last.date}`;
}

function insights(
  transactions: InterpretedTransaction[],
  summary: {
    income: number;
    spending: number;
    net: number;
    cashNet: number;
    transfers: number;
    unmatchedInternal: number;
    categories: MoneyFlowSummary["categories"];
  },
): string[] {
  if (transactions.length === 0) return ["Upload a statement to see where money came in and went out."];
  const lines: string[] = [];
  const topIn = transactions.filter((txn) => txn.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const topOut = transactions.filter((txn) => txn.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  if (topIn) lines.push(`Money came in mainly from ${topIn.merchant} (${formatAud(topIn.amount)}).`);
  if (summary.categories[0]) {
    lines.push(`The largest primary outflow tag is ${summary.categories[0].name} (${formatAud(summary.categories[0].amount)}).`);
  } else if (topOut) {
    lines.push(`The largest payment was ${topOut.merchant} (${formatAud(Math.abs(topOut.amount))}).`);
  }
  if (summary.transfers > 0) {
    lines.push(
      `${formatAud(summary.transfers)} moved between your own accounts, counted once rather than as both income and spending.`,
    );
  }
  if (summary.unmatchedInternal > 0) {
    lines.push(
      `${formatAud(summary.unmatchedInternal)} looks like a transfer but its other leg is not here, so it still counts. Upload the other account to settle it.`,
    );
  }
  lines.push(
    summary.cashNet >= 0
      ? `Net cash flow is ${formatAud(summary.cashNet)} after every movement.`
      : `More money left than came in by ${formatAud(Math.abs(summary.cashNet))}.`,
  );
  return lines.slice(0, 4);
}
