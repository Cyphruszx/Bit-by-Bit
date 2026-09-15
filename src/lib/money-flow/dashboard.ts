import { accountCaption, type AccountRegistry } from "@/lib/money-flow/account-identity";
import { chartLabel } from "@/lib/money-flow/category-book";
import { needsReview } from "@/lib/money-flow/classify";
import { monthKey } from "@/lib/money-flow/period";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { countedMovements, isEarnings, isRefundCredit, isSpending, tileAmount } from "@/lib/money-flow/summary";
import { topChartCategories } from "@/lib/money-flow/tag-charts";
import { categoryOf } from "@/lib/money-flow/tags";
import type { CategorySpend, InterpretedTransaction } from "@/lib/money-flow/types";

export type DashboardPoint = {
  key: string;
  label: string;
  value: number;
};

export type SpendSlice = CategorySpend & {
  label: string;
  color: string;
};

export type BudgetRow = {
  key: string;
  label: string;
  spent: number;
  target: number;
  over: number;
  percent: number;
};

export type LedgerPreviewRow = InterpretedTransaction & {
  position: number;
  account: string;
  categoryLabel: string;
  needsCategory: boolean;
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortMonthLabel(month: string): string {
  const [, monthNumber] = month.split("-").map(Number);
  return SHORT_MONTHS[(monthNumber ?? 1) - 1] ?? month;
}

export function payRunCount(transactions: InterpretedTransaction[]): number {
  return countedMovements(transactions).filter((txn) => isEarnings(txn) && categoryOf(txn) === "salary").length;
}

export function spendDonutSlices(categories: CategorySpend[], limit = 6): SpendSlice[] {
  return topChartCategories(categories, limit).map((row, index) => ({
    ...row,
    label: row.name === "Other" ? "Everything else" : chartLabel(row.name),
    color: `var(--color-chart-${(index % 8) + 1})`,
  }));
}

export function budgetRowsFromPrior(
  current: CategorySpend[],
  prior: CategorySpend[],
  limit = 4,
): BudgetRow[] {
  const priorBy = new Map(prior.map((row) => [row.name, row.amount]));
  return current
    .filter((row) => row.amount > 0 && row.name !== "transfers")
    .slice(0, limit)
    .map((row) => {
      const target = priorBy.get(row.name) ?? 0;
      const over = target > 0 ? Math.max(0, roundMoney(row.amount - target)) : 0;
      const percent = target > 0 ? Math.min(100, Math.round((row.amount / target) * 100)) : row.amount > 0 ? 100 : 0;
      return {
        key: row.name,
        label: chartLabel(row.name),
        spent: row.amount,
        target,
        over,
        percent,
      };
    });
}

export function monthlyNetDelta(transactions: InterpretedTransaction[], month: string): number {
  let delta = 0;
  for (const txn of countedMovements(transactions)) {
    if (monthKey(txn.dateIso) !== month) continue;
    if (isEarnings(txn)) delta += tileAmount(txn);
    else if (isSpending(txn)) delta -= Math.abs(tileAmount(txn));
    else if (isRefundCredit(txn)) delta += Math.abs(tileAmount(txn));
  }
  return roundMoney(delta);
}

export function monthlyBalanceSeries(
  transactions: InterpretedTransaction[],
  months: string[],
): DashboardPoint[] {
  const counted = countedMovements(transactions);
  const first = months[0];
  let running = 0;
  if (first) {
    for (const txn of counted) {
      const month = monthKey(txn.dateIso);
      if (!month || month >= first) continue;
      running += netOf(txn);
    }
    running = roundMoney(running);
  }

  const byMonth = new Map<string, number>();
  for (const txn of counted) {
    const month = monthKey(txn.dateIso);
    if (!months.includes(month)) continue;
    byMonth.set(month, roundMoney((byMonth.get(month) ?? 0) + netOf(txn)));
  }

  return months.map((key) => {
    running = roundMoney(running + (byMonth.get(key) ?? 0));
    return { key, label: shortMonthLabel(key), value: running };
  });
}

export function monthlySpendingSeries(
  transactions: InterpretedTransaction[],
  months: string[],
): DashboardPoint[] {
  const byMonth = new Map<string, number>();
  for (const txn of countedMovements(transactions)) {
    if (!isSpending(txn)) continue;
    const month = monthKey(txn.dateIso);
    if (!months.includes(month)) continue;
    byMonth.set(month, roundMoney((byMonth.get(month) ?? 0) + Math.abs(tileAmount(txn))));
  }
  return months.map((key) => ({
    key,
    label: shortMonthLabel(key),
    value: byMonth.get(key) ?? 0,
  }));
}

export function recentLedgerRows(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
  limit = 7,
): LedgerPreviewRow[] {
  const withPosition = withRunningPosition(transactions, registry);
  return withPosition.slice(-limit).reverse();
}

export function withRunningPosition(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): LedgerPreviewRow[] {
  const sorted = [...transactions].sort(
    (left, right) => left.dateIso.localeCompare(right.dateIso) || left.id.localeCompare(right.id),
  );
  let position = 0;
  return sorted.map((txn) => {
    position = roundMoney(position + txn.amount);
    return {
      ...txn,
      position,
      account: accountCaption(txn, registry),
      categoryLabel: chartLabel(txn.categoryKey),
      needsCategory: needsReview(txn),
    };
  });
}

function netOf(txn: InterpretedTransaction): number {
  if (isEarnings(txn)) return tileAmount(txn);
  if (isSpending(txn)) return -Math.abs(tileAmount(txn));
  if (isRefundCredit(txn)) return Math.abs(tileAmount(txn));
  return 0;
}
