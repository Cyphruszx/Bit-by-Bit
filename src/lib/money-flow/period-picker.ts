import {
  APP_TIME_ZONE,
  formatMonthLabel,
  isLastTwelveMonths,
  lastTwelveMonthsRange,
  monthBounds,
  monthKey,
  monthsFromDates,
  type PeriodFilter,
} from "@/lib/money-flow/period";

/** Short months the picker prints. ICU's en-AU "short" month is "Sept"/"June"/"July" on some hosts. */
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodMenuChoice =
  | { type: "month"; month: string }
  | { type: "last12" }
  | { type: "all" }
  | { type: "custom"; from: string; to: string };

export type PeriodMenuEntry =
  | { type: "month"; month: string; label: string; checked: boolean }
  | { type: "last12"; label: "Last 12 months"; checked: boolean }
  | { type: "all"; label: "All activity"; checked: boolean }
  | { type: "custom"; label: "Custom dates…"; checked: boolean };

/** Sydney civil month, matching the rest of the period calendar. */
export function sydneyMonthKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
}

/**
 * Months with activity, newest first. The month already on screen stays in the list
 * even when that month has no rows yet, so a stored month is never dropped.
 */
export function monthsForPicker(dateIsos: string[], period: PeriodFilter): string[] {
  const fromData = monthsFromDates(dateIsos);
  if (period.kind === "month" && !fromData.includes(period.month)) {
    return [period.month, ...fromData].sort((a, b) => b.localeCompare(a));
  }
  return fromData;
}

/** The month Last 12 months is counted back from: the open month, else the newest activity month. */
export function anchorMonth(period: PeriodFilter, months: string[], todayMonth: string): string {
  if (period.kind === "month") return period.month;
  return months[0] ?? todayMonth;
}

/** A range that is exactly twelve calendar months ending on its own last day. */
export function isLastTwelvePeriod(period: PeriodFilter): boolean {
  if (period.kind !== "range") return false;
  const to = period.from <= period.to ? period.to : period.from;
  return isLastTwelveMonths(period, monthKey(to));
}

/** Closed-button copy. Custom ranges name the year once; Last 12 months stays a name, not a span. */
export function periodPickerLabel(period: PeriodFilter): string {
  if (period.kind === "month") return formatMonthLabel(period.month);
  if (period.kind === "all") return "All activity";
  if (isLastTwelvePeriod(period)) return "Last 12 months";
  const from = period.from <= period.to ? period.from : period.to;
  const to = period.from <= period.to ? period.to : period.from;
  return customRangeLabel(from, to);
}

function customRangeLabel(from: string, to: string): string {
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  if (from === to) return `${dayMonth(from)} ${fromYear}`;
  if (fromYear === toYear) return `${dayMonth(from)} – ${dayMonth(to)} ${toYear}`;
  return `${dayMonth(from)} ${fromYear} – ${dayMonth(to)} ${toYear}`;
}

function dayMonth(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${SHORT_MONTH[(month ?? 1) - 1] ?? ""}`;
}

export function periodMenuEntries(period: PeriodFilter, months: string[], anchor: string): PeriodMenuEntry[] {
  const list = months.length > 0 ? months : [anchor];
  const lastTwelve = isLastTwelvePeriod(period);
  return [
    ...list.map((month) => ({
      type: "month" as const,
      month,
      label: formatMonthLabel(month),
      checked: period.kind === "month" && period.month === month,
    })),
    { type: "last12", label: "Last 12 months", checked: lastTwelve },
    { type: "all", label: "All activity", checked: period.kind === "all" },
    {
      type: "custom",
      label: "Custom dates…",
      checked: period.kind === "range" && !lastTwelve,
    },
  ];
}

/** What a menu row does. Custom dates are applied separately once From and To are filled in. */
export function choosePeriod(
  choice: Exclude<PeriodMenuChoice, { type: "custom" }>,
  anchor: string,
): PeriodFilter {
  if (choice.type === "month") return { kind: "month", month: choice.month };
  if (choice.type === "last12") return lastTwelveMonthsRange(anchor);
  return { kind: "all" };
}

export function chooseCustomRange(from: string, to: string): PeriodFilter | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return null;
  return { kind: "range", from, to };
}

export function customDateDraft(period: PeriodFilter, anchor: string): { from: string; to: string } {
  if (period.kind === "range") {
    const from = period.from <= period.to ? period.from : period.to;
    const to = period.from <= period.to ? period.to : period.from;
    return { from, to };
  }
  return monthBounds(period.kind === "month" ? period.month : anchor);
}

/** Arrow, Home, and End movement through the open menu. Null leaves the index alone. */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
