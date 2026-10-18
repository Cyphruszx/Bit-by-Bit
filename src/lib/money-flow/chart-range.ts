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

/** Daily while a window still fits on the card; longer ranges (All) collapse to months. */
const MAX_DAILY_SPAN = 184;

export type CumulativePoint = {
  key: string;
  label: string;
  value: number;
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
 * One rising total for the chosen direction. The first point is $0 at the start of the window,
 * then each bucket adds that direction only.
 *
 * The rows are the same ones the Money in and Money out cards add: statement `amount` by
 * sign, internal transfers left out, for this window and bank selection. Income verdicts
 * and spend groups do not decide the line.
 */
export function cumulativeLine(
  transactions: InterpretedTransaction[],
  direction: ChartDirection,
  window: PeriodFilter,
  selected = "All",
): CumulativePoint[] {
  const rows = filterByPeriod(excludingInternalTransfers(transactions), window).filter(
    (txn) => selected === "All" || matches(txn, selected),
  );
  const bounds = windowBounds(window, rows);
  if (!bounds) return [];

  const totals = new Map<string, number>();
  const byDay = spanInDays(bounds.from, bounds.to) <= MAX_DAILY_SPAN;
  for (const txn of rows) {
    const amount = directionAmount(txn, direction);
    if (amount === 0) continue;
    const key = calendarDate(txn.dateIso).slice(0, byDay ? 10 : 7);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const keys = byDay ? daySpan(bounds.from, bounds.to) : monthSpan(bounds.from.slice(0, 7), bounds.to.slice(0, 7));
  const points: CumulativePoint[] = [
    {
      // Sorts ahead of the YYYY-MM-DD bucket keys so the $0 point stays at the left edge.
      key: `#${bounds.from}`,
      label: byDay ? formatChartDate(bounds.from) : monthLabelFromKey(bounds.from.slice(0, 7)),
      value: 0,
    },
  ];
  let running = 0;
  for (const key of keys) {
    running += totals.get(key) ?? 0;
    points.push({
      key,
      label: byDay ? formatChartDate(key) : monthLabelFromKey(key),
      value: roundMoney(running),
    });
  }
  return points;
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
  const to = days[days.length - 1];
  return from && to ? { from, to } : null;
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
