import { formatAud } from "@/lib/format";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

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
  const expenseByCategory = new Map<string, number>();
  for (const txn of transactions) {
    if (txn.type === "transfer" || txn.type === "income" || txn.amount >= 0) continue;
    const primary = tagsOf(txn)[0];
    const current = expenseByCategory.get(primary) ?? 0;
    expenseByCategory.set(primary, roundMoney(current + Math.abs(txn.amount)));
  }
  const categories = [...expenseByCategory.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      share: spending > 0 ? Math.round((amount / spending) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

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
  summary: { income: number; spending: number; net: number; transfers: number; categories: MoneyFlowSummary["categories"] },
): string[] {
  if (transactions.length === 0) return ["Upload a statement to see where money came in and went out."];
  const lines: string[] = [];
  const topIn = transactions.filter((txn) => txn.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const topOut = transactions.filter((txn) => txn.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  if (topIn) lines.push(`Money came in mainly from ${topIn.merchant} (${formatAud(topIn.amount)}).`);
  if (summary.categories[0]) {
    lines.push(`The largest outflow category is ${summary.categories[0].name} (${formatAud(summary.categories[0].amount)}).`);
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
