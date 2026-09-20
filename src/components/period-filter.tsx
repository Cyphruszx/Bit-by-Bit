"use client";

import { useMemo } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { PeriodChip } from "@/components/period-chip";
import {
  formatMonthLabel,
  isLastTwelveMonths,
  lastTwelveMonthsRange,
  monthBounds,
  monthsFromDates,
  shiftMonth,
  type PeriodFilter,
} from "@/lib/money-flow/period";

export function PeriodFilterBar() {
  const { allTransactions, period, setPeriod } = useMoneyFlow();
  const months = useMemo(() => {
    const fromData = monthsFromDates(allTransactions.map((txn) => txn.dateIso));
    if (period.kind === "month" && !fromData.includes(period.month)) {
      return [period.month, ...fromData].sort((a, b) => b.localeCompare(a));
    }
    return fromData;
  }, [allTransactions, period]);
  const selectedMonth = period.kind === "month" ? period.month : months[0] ?? currentMonth();
  const monthIndex = months.indexOf(selectedMonth);
  const hasPrev = monthIndex >= 0 && monthIndex < months.length - 1;
  const hasNext = monthIndex > 0;
  const lastTwelve = lastTwelveMonthsRange(selectedMonth);

  return (
    <div className="app-period">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-2 px-5 py-[11px] md:px-7">
        <p className="mr-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted">Period</p>
        <PeriodChip
          active={period.kind === "month"}
          onClick={() => setPeriod({ kind: "month", month: selectedMonth })}
        >
          {formatMonthLabel(selectedMonth)}
        </PeriodChip>
        <PeriodChip
          active={isLastTwelveMonths(period, selectedMonth)}
          onClick={() => setPeriod(lastTwelve)}
        >
          Last 12 months
        </PeriodChip>
        <PeriodChip
          active={period.kind === "range" && !isLastTwelveMonths(period, selectedMonth)}
          onClick={() => setPeriod(rangeFrom(period, selectedMonth))}
        >
          Custom dates
        </PeriodChip>
        <PeriodChip active={period.kind === "all"} onClick={() => setPeriod({ kind: "all" })}>
          All activity
        </PeriodChip>
        {period.kind === "month" ? (
          <div className="flex items-center gap-1">
            <PeriodChip
              active={false}
              onClick={() => hasPrev && setPeriod({ kind: "month", month: months[monthIndex + 1] })}
              disabled={!hasPrev}
              ariaLabel="Previous month with activity"
            >
              ‹
            </PeriodChip>
            <select
              id="period-month"
              value={period.month}
              onChange={(event) => {
                if (event.target.value) setPeriod({ kind: "month", month: event.target.value });
              }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-soft outline-none focus:border-primary"
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
            <PeriodChip
              active={false}
              onClick={() => hasNext && setPeriod({ kind: "month", month: months[monthIndex - 1] })}
              disabled={!hasNext}
              ariaLabel="Next month with activity"
            >
              ›
            </PeriodChip>
          </div>
        ) : null}
        {period.kind === "range" && !isLastTwelveMonths(period, selectedMonth) ? (
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              label="From"
              value={period.from}
              onChange={(from) => setPeriod({ kind: "range", from, to: period.to })}
            />
            <DateField
              label="To"
              value={period.to}
              onChange={(to) => setPeriod({ kind: "range", from: period.from, to })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-primary outline-none focus:border-primary"
      />
    </label>
  );
}

function rangeFrom(period: PeriodFilter, fallbackMonth: string): PeriodFilter {
  if (period.kind === "range") return period;
  if (period.kind === "month") {
    const bounds = monthBounds(period.month);
    return { kind: "range", from: bounds.from, to: bounds.to };
  }
  const bounds = monthBounds(fallbackMonth);
  return { kind: "range", from: bounds.from, to: bounds.to };
}

function currentMonth(): string {
  return shiftMonth(`${new Date().getUTCFullYear()}-01`, new Date().getUTCMonth());
}
