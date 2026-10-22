import { monthLabelFromKey } from "@/lib/money-flow/savings";
import { roundMoney } from "@/lib/money-flow/parse-values";
import {
  APP_TIME_ZONE,
  calendarDate,
  filterByPeriod,
  monthBounds,
  monthKey,
  shiftMonth,
  type PeriodFilter,
} from "@/lib/money-flow/period";
import { excludingInternalTransfers } from "@/lib/money-flow/internal-transfers";
import { matches } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type ChartSpan = "1W" | "1M" | "3M" | "6M" | "All";
export type ChartDirection = "in" | "out";

/** A span the reader picked, or the page period after the month picker changes. */
export type ChartRangeMode = { kind: "span"; span: ChartSpan } | { kind: "page" };

export const DEFAULT_CHART_RANGE: ChartRangeMode = { kind: "span", span: "1M" };

export const CHART_SPANS: ChartSpan[] = ["1W", "1M", "3M", "6M", "All"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type ChartBucket = "day" | "week" | "month";

export type ChartPoint = {
  key: string;
  label: string;
  value: number;
};

/** One point per bucket, the range's own total, and whether any counted row fell in the range. */
export type FlowSeries = {
  points: ChartPoint[];
  total: number;
  hasData: boolean;
};

export function sydneyDay(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/**
 * The chart keeps its span until the month picker writes a new period.
 * Loading the stored period does not count: that revision stays 0.
 */
export function chartModeForRevision(seenRevision: number, revision: number, mode: ChartRangeMode): ChartRangeMode {
  return seenRevision === revision ? mode : { kind: "page" };
}

/**
 * Which segment the page period lights up.
 * A calendar month is 1M and all activity is All. A custom range lights nothing.
 */
export function highlightedSpan(mode: ChartRangeMode, pagePeriod: PeriodFilter): ChartSpan | null {
  if (mode.kind === "span") return mode.span;
  if (pagePeriod.kind === "all") return "All";
  if (pagePeriod.kind === "month") return "1M";
  return null;
}

/** The day a span counts back from: the open period's end, or today when the page is on everything. */
export function chartAnchorDay(pagePeriod: PeriodFilter, today: string): string {
  if (pagePeriod.kind === "month") {
    const end = monthBounds(pagePeriod.month).to;
    return today.slice(0, 7) === pagePeriod.month && today < end ? today : end;
  }
  if (pagePeriod.kind === "range") {
    return pagePeriod.from <= pagePeriod.to ? pagePeriod.to : pagePeriod.from;
  }
  return today;
}

/** The dates the line covers. A picked span is counted back from the page period's end. */
export function chartWindow(mode: ChartRangeMode, pagePeriod: PeriodFilter, today: string): PeriodFilter {
  if (mode.kind === "page") return pagePeriod;
  return spanWindow(mode.span, chartAnchorDay(pagePeriod, today));
}

export function spanWindow(span: ChartSpan, anchorDay: string): PeriodFilter {
  if (span === "All") return { kind: "all" };
  if (span === "1W") return { kind: "range", from: addDays(anchorDay, -6), to: anchorDay };
  const months = span === "1M" ? 1 : span === "3M" ? 3 : 6;
  const endMonth = monthKey(anchorDay);
  const startMonth = shiftMonth(endMonth, -(months - 1));
  return { kind: "range", from: monthBounds(startMonth).from, to: monthBounds(endMonth).to };
}

/**
 * Bucket size for the line: daily for 1W and 1M, Monday-start weeks for 3M, months for 6M and All.
 * The page period on its own reads as daily for a month or a short custom range.
 */
export function chartBucket(mode: ChartRangeMode, window: PeriodFilter): ChartBucket {
  if (mode.kind === "span") {
    if (mode.span === "1W" || mode.span === "1M") return "day";
    return mode.span === "3M" ? "week" : "month";
  }
  if (window.kind === "all") return "month";
  if (window.kind === "month") return "day";
  const from = window.from <= window.to ? window.from : window.to;
  const to = window.from <= window.to ? window.to : window.from;
  const days = spanInDays(from, to);
  return days <= 45 ? "day" : days <= 120 ? "week" : "month";
}

/**
 * Each point is that bucket's own money in or out, not a running total. Past buckets with
 * nothing in them sit at $0, and the line stops at today: no points for future buckets.
 *
 * The rows are the same ones the Money in and Money out cards add: statement `amount` by
 * sign, internal transfers left out, for this window and bank selection. Income verdicts
 * and spend groups do not decide the line.
 */
export function flowSeries(
  transactions: InterpretedTransaction[],
  direction: ChartDirection,
  window: PeriodFilter,
  bucket: ChartBucket,
  today: string,
  selected = "All",
): FlowSeries {
  const rows = filterByPeriod(excludingInternalTransfers(transactions), window).filter(
    (txn) => selected === "All" || matches(txn, selected),
  );
  let total = 0;
  const totals = new Map<string, number>();
  for (const txn of rows) {
    const amount = directionAmount(txn, direction);
    if (amount === 0) continue;
    total += amount;
    const key = bucketKey(calendarDate(txn.dateIso), bucket);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  const hasData = rows.length > 0;
  const bounds = windowBounds(window, rows, today);
  if (!bounds) return { points: [], total: roundMoney(total), hasData };

  const last = bounds.to < today ? bounds.to : today;
  const points: ChartPoint[] = [];
  if (bounds.from <= last) {
    for (const key of bucketKeys(bounds.from, last, bucket)) {
      points.push({ key, label: bucketLabel(key, bucket), value: roundMoney(totals.get(key) ?? 0) });
    }
  }
  return { points, total: roundMoney(total), hasData };
}

/** Three labels: $0, the halfway mark, and a rounded ceiling the series fits under. */
export function chartScale(maxValue: number): { max: number; mid: number } {
  if (maxValue <= 0) return { max: 1, mid: 0.5 };
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  const n = maxValue / magnitude;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  const max = nice * magnitude;
  return { max, mid: max / 2 };
}

export function formatChartAxis(amount: number): string {
  if (amount === 0) return "$0";
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    const thousands = abs / 1000;
    const text = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1).replace(/\.0$/, "");
    return `$${text}k`;
  }
  const whole = Math.round(abs);
  return Number.isInteger(abs) || Math.abs(abs - whole) < 0.001 ? `$${whole}` : `$${abs}`;
}

export function formatChartDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${SHORT_MONTH[(month ?? 1) - 1] ?? ""}`;
}

/** Statement amount by sign. Transfers are already removed. `baseAmount` is not the card figure. */
function directionAmount(txn: InterpretedTransaction, direction: ChartDirection): number {
  if (direction === "in") return txn.amount > 0 ? txn.amount : 0;
  return txn.amount < 0 ? Math.abs(txn.amount) : 0;
}

function windowBounds(
  window: PeriodFilter,
  rows: InterpretedTransaction[],
  today: string,
): { from: string; to: string } | null {
  if (window.kind === "month") return monthBounds(window.month);
  if (window.kind === "range") {
    const from = window.from <= window.to ? window.from : window.to;
    const to = window.from <= window.to ? window.to : window.from;
    return ISO_DAY.test(from) && ISO_DAY.test(to) ? { from, to } : null;
  }
  const days = rows
    .map((txn) => calendarDate(txn.dateIso))
    .filter((day) => ISO_DAY.test(day))
    .sort();
  const from = days[0];
  const newest = days[days.length - 1];
  if (!from || !newest) return null;
  // All runs up to today so quiet months since the last import read as $0.
  return { from, to: newest > today ? newest : today };
}

function addDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function spanInDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
}

function bucketKey(day: string, bucket: ChartBucket): string {
  if (bucket === "day") return day;
  if (bucket === "month") return day.slice(0, 7);
  return mondayOf(day);
}

/** Monday on or before the day: weeks start on Monday. */
function mondayOf(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, (month ?? 1) - 1, date ?? 1)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function bucketKeys(from: string, to: string, bucket: ChartBucket): string[] {
  if (bucket === "month") return monthSpan(from.slice(0, 7), to.slice(0, 7));
  if (bucket === "day") return daySpan(from, to);
  const keys: string[] = [];
  for (let week = mondayOf(from); week <= to && keys.length < 600; week = addDays(week, 7)) keys.push(week);
  return keys;
}

function bucketLabel(key: string, bucket: ChartBucket): string {
  if (bucket === "month") return monthLabelFromKey(key);
  if (bucket === "week") return `Week of ${formatChartDate(key)}`;
  return formatChartDate(key);
}

function daySpan(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let day = from; day <= to && keys.length < 400; day = addDays(day, 1)) keys.push(day);
  return keys;
}

function monthSpan(from: string, to: string): string[] {
  const keys: string[] = [];
  let month = from;
  while (keys.length < 240 && month <= to) {
    keys.push(month);
    month = shiftMonth(month, 1);
  }
  return keys;
}
