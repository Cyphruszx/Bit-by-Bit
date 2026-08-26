"use client";

import { useMemo, type ReactNode } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import {
  formatMonthLabel,
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
  const hasPrev = period.kind === "month" && monthIndex >= 0 && monthIndex < months.length - 1;
  const hasNext = period.kind === "month" && monthIndex > 0;

  return (
    <div className="border-b border-[#dce4df] bg-[#f6f8f7]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
        <p className="mr-1 text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">Period</p>
        <PeriodChip active={period.kind === "all"} onClick={() => setPeriod({ kind: "all" })}>
          All activity
        </PeriodChip>
        <div className="flex items-center gap-1">
          <PeriodChip
            active={false}
            onClick={() => hasPrev && setPeriod({ kind: "month", month: months[monthIndex + 1] })}
            disabled={!hasPrev}
            ariaLabel="Previous month with activity"
          >
            ‹
          </PeriodChip>
          <label className="flex items-center gap-2 text-sm text-[#60716a]" htmlFor="period-month">
            Month
          </label>
          <select
            id="period-month"
            value={period.kind === "month" ? period.month : ""}
            onChange={(event) => {
              if (event.target.value) setPeriod({ kind: "month", month: event.target.value });
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold outline-none focus:border-[#173b31] ${
              period.kind === "month"
                ? "border-[#173b31] bg-[#173b31] text-white"
                : "border-[#dce4df] bg-white text-[#355a3f]"
            }`}
          >
            <option value="" disabled>
              {months.length === 0 ? "No months yet" : "Choose month"}
            </option>
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
        <PeriodChip
          active={period.kind === "range"}
          onClick={() => setPeriod(rangeFrom(period, selectedMonth))}
        >
          Custom dates
        </PeriodChip>
        {period.kind === "range" ? (
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

function PeriodChip({
  active,
  onClick,
  children,
  disabled = false,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold disabled:opacity-35 ${
        active ? "bg-[#173b31] text-white" : "border border-[#dce4df] bg-white text-[#355a3f]"
      }`}
    >
      {children}
    </button>
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
    <label className="flex items-center gap-2 text-sm text-[#60716a]">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm font-semibold text-[#173b31] outline-none focus:border-[#173b31]"
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
