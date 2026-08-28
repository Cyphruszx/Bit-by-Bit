import { formatAud } from "@/lib/format";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { primaryTag, subTags, tagsOf } from "@/lib/money-flow/tags";
import type { CategorySpend, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

export type TagFlowDirection = "out" | "in";
export const NO_SUB_TAG = "No sub-tag";

export type TagChartSeries = {
  rows: CategorySpend[];
  level: "primary" | "sub";
  total: number;
  parent: string | null;
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
  const transfers = roundMoney(
    transactions.filter((txn) => txn.type === "transfer").reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const refunds = roundMoney(
    transactions.filter((txn) => txn.type === "refund").reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
  );
  const net = roundMoney(income - spending);
  const categories = spendByTags(transactions);

  return {
    income,
    spending,
    net,
    transfers,
    refunds,
    transactionCount: transactions.length,
    categories,
    periodLabel: periodLabel(transactions),
    insights: insights(transactions, { income, spending, net, transfers, categories }),
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

export function amountByFirstSubTag(
  transactions: InterpretedTransaction[],
  direction: TagFlowDirection = "out",
): CategorySpend[] {
  return aggregateByTag(directed(transactions, direction), (txn) => subTags(txn)[0] ?? NO_SUB_TAG);
}

export function chartTagSeries(
  transactions: InterpretedTransaction[],
  selectedTag: string,
  direction: TagFlowDirection = "out",
): TagChartSeries {
  const rows = directed(transactions, direction);
  const selectedIsPrimary = rows.some((txn) => primaryTag(txn) === selectedTag);

  if (selectedTag !== "All" && selectedIsPrimary) {
    const underPrimary = rows.filter((txn) => primaryTag(txn) === selectedTag);
    const hasSub = underPrimary.some((txn) => subTags(txn).length > 0);
    return {
      rows: hasSub ? amountByFirstSubTag(underPrimary, direction) : amountByPrimaryTags(underPrimary, direction),
      level: hasSub ? "sub" : "primary",
      total: signedTotal(underPrimary),
      parent: selectedTag,
    };
  }

  const filtered =
    selectedTag === "All" ? rows : rows.filter((txn) => tagsOf(txn).includes(selectedTag));
  return {
    rows: amountByPrimaryTags(filtered, direction),
    level: "primary",
    total: signedTotal(filtered),
    parent: null,
  };
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
    const fingerprint = `${row.dateIso}|${row.amount}|${row.merchant.toLowerCase()}`;
    const fromThisFile = `${fingerprint}|${row.sourceFile}`;
    if (seen.has(fingerprint) && !seen.has(fromThisFile)) return false;
    seen.add(fingerprint);
    seen.add(fromThisFile);
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
  summary: { income: number; spending: number; net: number; transfers: number; categories: MoneyFlowSummary["categories"] },
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
    lines.push(`${formatAud(summary.transfers)} moved into savings or transfers — that is money set aside, not spent.`);
  }
  lines.push(
    summary.net >= 0
      ? `Net cash flow is ${formatAud(summary.net)} in after spending.`
      : `Spending outpaced income by ${formatAud(Math.abs(summary.net))}.`,
  );
  return lines.slice(0, 4);
}
