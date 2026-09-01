import { formatAud } from "@/lib/format";
import { formatDisplayDate, roundMoney } from "@/lib/money-flow/parse-values";
import { monthLabelFromKey } from "@/lib/money-flow/savings";
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

export function summarizeMoneyFlow(transactions: InterpretedTransaction[]): MoneyFlowSummary {
  const income = roundMoney(
    transactions.filter((txn) => txn.amount > 0 && txn.type !== "transfer").reduce((sum, txn) => sum + txn.amount, 0),
  );
  const spending = roundMoney(
    transactions
      .filter((txn) => txn.amount < 0 && txn.type !== "transfer")
      .reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const cashIn = roundMoney(
    transactions.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0),
  );
  const cashOut = roundMoney(
    transactions.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const transfers = roundMoney(
    transactions.filter((txn) => txn.type === "transfer").reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
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
    refunds,
    transactionCount: transactions.length,
    categories,
    periodLabel: periodLabel(transactions),
    insights: insights(transactions, { income, spending, net, cashNet, transfers, categories }),
  };
}

export function isOutflow(txn: InterpretedTransaction): boolean {
  return txn.amount < 0 && txn.type !== "transfer";
}

export function isInflow(txn: InterpretedTransaction): boolean {
  return txn.amount > 0 && txn.type !== "transfer";
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
  const rows = transactions.filter((txn) => txn.type !== "transfer" && txn.amount !== 0);
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
 * Buckets money in and out by month, dropping to a daily bucket when the period covers one month.
 * Every bucket between the first and last is emitted, including quiet ones: the chart spaces points
 * evenly, so skipping a month would draw its neighbours as if they were consecutive.
 */
export function tagFlowOverTime(
  transactions: InterpretedTransaction[],
  selectedTag = "All",
): FlowOverTimePoint[] {
  const rows = transactions.filter(
    (txn) =>
      txn.type !== "transfer" &&
      txn.amount !== 0 &&
      Boolean(txn.dateIso) &&
      (selectedTag === "All" || tagsOf(txn).includes(selectedTag)),
  );
  if (rows.length === 0) return [];

  const byDay = new Set(rows.map((txn) => txn.dateIso.slice(0, 7))).size < 2;
  const totals = new Map<string, { income: number; spending: number }>();

  for (const txn of rows) {
    const key = txn.dateIso.slice(0, byDay ? 10 : 7);
    const entry = totals.get(key) ?? { income: 0, spending: 0 };
    if (txn.amount > 0) entry.income = roundMoney(entry.income + txn.amount);
    else entry.spending = roundMoney(entry.spending + Math.abs(txn.amount));
    totals.set(key, entry);
  }

  const present = [...totals.keys()].sort();
  const first = present[0];
  const last = present[present.length - 1];
  const keys = byDay ? daySpan(first, last) : monthSpan(first, last);

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
const MAX_BUCKETS = 400;

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
  return transactions.filter((txn) => (direction === "out" ? isOutflow(txn) : isInflow(txn)));
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

export function uniqueTransactions(rows: InterpretedTransaction[]): InterpretedTransaction[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.dateIso}|${row.amount}|${row.merchant.toLowerCase()}`;
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
      `${formatAud(summary.transfers)} moved between accounts or into savings — that is included in money in and out, but it is not spending.`,
    );
  }
  lines.push(
    summary.cashNet >= 0
      ? `Net cash flow is ${formatAud(summary.cashNet)} after every movement.`
      : `More money left than came in by ${formatAud(Math.abs(summary.cashNet))}.`,
  );
  return lines.slice(0, 4);
}
