import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

export type PeriodFilter =
  | { kind: "all" }
  | { kind: "month"; month: string }
  | { kind: "range"; from: string; to: string };

export const ALL_PERIOD: PeriodFilter = { kind: "all" };

/** Spec 10 periods are civil dates in this zone, not UTC and not the device TZ. */
export const APP_TIME_ZONE = "Australia/Sydney";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Sydney calendar date for a row.
 *
 * A `YYYY-MM-DD` value is already a civil date (AU statements print one) and is left
 * alone so midnight UTC cannot slide it into the next Sydney day. Instants are converted
 * with `Australia/Sydney`, including DST.
 */
export function calendarDate(value: string): string {
  if (CIVIL_DATE.test(value)) return value;
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return value.length >= 10 ? value.slice(0, 10) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : value.slice(0, 10);
}

export function monthKey(dateIso: string): string {
  return calendarDate(dateIso).slice(0, 7);
}

export function monthsFromDates(dateIsos: string[]): string[] {
  const months = new Set<string>();
  for (const dateIso of dateIsos) {
    const day = calendarDate(dateIso);
    if (CIVIL_DATE.test(day)) months.add(monthKey(day));
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = lastDayOfMonth(year, monthNumber);
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  // Mid-month noon UTC is the same calendar month in Sydney (UTC+10/+11).
  return new Date(Date.UTC(year, monthNumber - 1, 15, 12)).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

export function inPeriod(dateIso: string, filter: PeriodFilter): boolean {
  const day = calendarDate(dateIso);
  if (!CIVIL_DATE.test(day)) return filter.kind === "all";
  if (filter.kind === "all") return true;
  if (filter.kind === "month") {
    return monthKey(day) === filter.month;
  }
  const from = filter.from <= filter.to ? filter.from : filter.to;
  const to = filter.from <= filter.to ? filter.to : filter.from;
  return day >= from && day <= to;
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
  const dates = transactions.map((txn) => calendarDate(txn.dateIso)).filter(Boolean).sort();
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
