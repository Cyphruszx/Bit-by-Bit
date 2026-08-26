import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

export type PeriodFilter =
  | { kind: "all" }
  | { kind: "month"; month: string }
  | { kind: "range"; from: string; to: string };

export const ALL_PERIOD: PeriodFilter = { kind: "all" };

export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function monthsFromDates(dateIsos: string[]): string[] {
  const months = new Set<string>();
  for (const dateIso of dateIsos) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) months.add(monthKey(dateIso));
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function inPeriod(dateIso: string, filter: PeriodFilter): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return filter.kind === "all";
  if (filter.kind === "all") return true;
  if (filter.kind === "month") {
    return monthKey(dateIso) === filter.month;
  }
  const from = filter.from <= filter.to ? filter.from : filter.to;
  const to = filter.from <= filter.to ? filter.to : filter.from;
  return dateIso >= from && dateIso <= to;
}

export function filterByPeriod<T extends { dateIso: string }>(items: T[], filter: PeriodFilter): T[] {
  if (filter.kind === "all") return items;
  return items.filter((item) => inPeriod(item.dateIso, filter));
}

export function describePeriod(filter: PeriodFilter, transactions: InterpretedTransaction[] = []): string {
  if (filter.kind === "month") return formatMonthLabel(filter.month);
  if (filter.kind === "range") {
    const from = filter.from <= filter.to ? filter.from : filter.to;
    const to = filter.from <= filter.to ? filter.to : filter.from;
    if (from === to) return formatDisplayDate(from);
    return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  }
  if (transactions.length === 0) return "All activity";
  const dates = transactions.map((txn) => txn.dateIso).filter(Boolean).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "All activity";
  if (monthKey(first) === monthKey(last)) return formatMonthLabel(monthKey(first));
  return `All activity · ${formatDisplayDate(first)} – ${formatDisplayDate(last)}`;
}

export function summarizePeriod(
  transactions: InterpretedTransaction[],
  filter: PeriodFilter,
): MoneyFlowSummary {
  const visible = filterByPeriod(transactions, filter);
  const flow = summarizeMoneyFlow(visible);
  flow.periodLabel = describePeriod(filter, visible);
  if (visible.length === 0 && filter.kind !== "all") {
    flow.insights = [`No movements in ${flow.periodLabel}. Try another month, a date range, or all activity.`];
  }
  return flow;
}

export function parsePeriod(value: unknown): PeriodFilter {
  if (!value || typeof value !== "object") return ALL_PERIOD;
  const record = value as Record<string, unknown>;
  if (record.kind === "month" && typeof record.month === "string" && /^\d{4}-\d{2}$/.test(record.month)) {
    return { kind: "month", month: record.month };
  }
  if (
    record.kind === "range" &&
    typeof record.from === "string" &&
    typeof record.to === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.to)
  ) {
    return { kind: "range", from: record.from, to: record.to };
  }
  return ALL_PERIOD;
}
