"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { LineChart, type LineChartSeries } from "@/components/line-chart";
import { formatAud } from "@/lib/format";
import { chartLabel, resolvedBook } from "@/lib/money-flow/category-book";
import {
  CHART_SPANS,
  DEFAULT_CHART_RANGE,
  chartModeForRevision,
  chartWindow,
  chartBucket,
  flowSeries,
  highlightedSpan,
  sydneyDay,
  type ChartDirection,
  type ChartRangeMode,
} from "@/lib/money-flow/chart-range";
import { filterByPeriod } from "@/lib/money-flow/period";
import { getPeriodRevision, subscribePeriodRevision } from "@/lib/money-flow/period-revision";
import type { PeriodFilter } from "@/lib/money-flow/period";
import {
  countedMovements,
  selectableCategories,
  selectableGroups,
} from "@/lib/money-flow/summary";
import {
  nextTagSelection,
} from "@/lib/money-flow/category-charts";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const ALL_PERIOD: PeriodFilter = { kind: "all" };

export function CategoryChartCard({
  transactions = [],
  selectedTag,
  onSelectTag,
  pagePeriod = ALL_PERIOD,
  compact = false,
}: {
  transactions?: InterpretedTransaction[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  /** The month picker. A change replaces the chart window; a custom range lights no segment. */
  pagePeriod?: PeriodFilter;
  compact?: boolean;
}) {
  const [direction, setDirection] = useState<ChartDirection>("in");
  const [mode, setMode] = useState<ChartRangeMode>(DEFAULT_CHART_RANGE);
  const revision = useSyncExternalStore(subscribePeriodRevision, getPeriodRevision, () => 0);
  const [seenRevision, setSeenRevision] = useState(revision);
  const activeMode = chartModeForRevision(seenRevision, revision, mode);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    setMode(activeMode);
  }

  const today = sydneyDay();
  const range = chartWindow(activeMode, pagePeriod, today);
  const span = highlightedSpan(activeMode, pagePeriod);
  const bucket = chartBucket(activeMode, range);
  const series = useMemo(
    () => flowSeries(transactions, direction, range, bucket, today, selectedTag),
    [bucket, direction, range, selectedTag, today, transactions],
  );
  const emptyMessage = range.kind === "month" || pagePeriod.kind === "month" ? "No data for this month" : "No data for this period";
  const chartHeight = compact ? 180 : 220;
  const windowed = useMemo(
    () => filterByPeriod(countedMovements(transactions), range),
    [range, transactions],
  );
  const primaries = useMemo(() => selectableGroups(windowed), [windowed]);
  const subs = useMemo(
    () => (selectedTag === "All" ? [] : selectableCategories(windowed, selectedTag)),
    [selectedTag, windowed],
  );

  return (
    <article className={`card ${compact ? "p-4" : "p-6"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={compact ? "text-base font-bold" : "text-lg font-bold"}>Money by group</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Money direction"
            value={direction}
            options={[
              ["in", "Money in"],
              ["out", "Money out"],
            ]}
            onChange={setDirection}
          />
          <Segmented
            label="Chart period"
            value={span}
            options={CHART_SPANS.map((item) => [item, item])}
            onChange={(next) => setMode({ kind: "span", span: next })}
          />
        </div>
      </div>
      <p className={`${compact ? "mt-2" : "mt-3"} text-sm text-ink-soft`} data-chart-total>
        {direction === "in" ? "Money in" : "Money out"} for this range:{" "}
        <span className="font-semibold text-ink">{formatAud(series.total)}</span>
      </p>
      {!series.hasData || series.points.length === 0 ? (
        <div
          className={`${compact ? "mt-3" : "mt-5"} flex items-center justify-center`}
          style={{ height: chartHeight }}
          data-chart-empty
        >
          <p className="text-center text-sm text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <FlowLineChart points={series.points} direction={direction} height={chartHeight} compact={compact} />
      )}
      {!series.hasData || series.points.length === 0 ? (
        <div className={`${compact ? "mt-3 space-y-2" : "mt-5 space-y-3"}`} data-chips-placeholder>
          <ChipRow label="Group" compact={compact}>
            {["All", ...resolvedBook().groups.map((group) => group.id)].map((id) => (
              <TagToggle key={id} active={false} disabled onClick={() => undefined} compact={compact}>
                {id === "All" ? "All" : chartLabel(id)}
              </TagToggle>
            ))}
          </ChipRow>
        </div>
      ) : primaries.length > 0 || subs.length > 0 ? (
        <div className={`${compact ? "mt-3 space-y-2" : "mt-5 space-y-3"}`}>
          <ChipRow label="Group" compact={compact}>
            <TagToggle active={selectedTag === "All"} onClick={() => onSelectTag("All")} compact={compact}>
              All
            </TagToggle>
            {primaries.map((name) => (
              <TagToggle
                key={name}
                active={selectedTag === name}
                onClick={() => onSelectTag(nextTagSelection(selectedTag, name))}
                compact={compact}
              >
                {chartLabel(name)}
              </TagToggle>
            ))}
          </ChipRow>
          {subs.length > 0 ? (
            <ChipRow label="Category" compact={compact}>
              {subs.map((name) => (
                <TagToggle
                  key={name}
                  active={selectedTag === name}
                  onClick={() => onSelectTag(nextTagSelection(selectedTag, name))}
                  compact={compact}
                >
                  {chartLabel(name)}
                </TagToggle>
              ))}
            </ChipRow>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex h-8 overflow-hidden rounded-[4px] border-2 border-line bg-surface">
      {options.map(([option, text], index) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`flex h-full items-center px-3 font-sans text-xs font-semibold leading-none ${
              index > 0 ? "border-l-2 border-line" : ""
            } ${selected ? "bg-primary text-on-primary" : "bg-surface text-ink-soft"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

function ChipRow({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted ${compact ? "w-12" : "w-16"}`}>
        {label}
      </span>
      {children}
    </div>
  );
}

function TagToggle({
  active,
  onClick,
  children,
  compact = false,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  compact?: boolean;
  /** Placeholder chip in an empty range: keeps the card height, cannot be tapped. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={disabled ? undefined : active}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full font-semibold ${disabled ? "pointer-events-none opacity-40" : ""} ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
        active ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

function FlowLineChart({
  points,
  direction,
  height,
  compact = false,
}: {
  points: Array<{ key: string; label: string; value: number }>;
  direction: ChartDirection;
  height: number;
  compact?: boolean;
}) {
  const series: LineChartSeries[] = [
    {
      id: direction,
      label: direction === "in" ? "Money in" : "Money out",
      color: "var(--color-primary)",
      points,
    },
  ];

  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      <LineChart
        series={series}
        height={height}
        ariaLabel={direction === "in" ? "Money in per period by group" : "Money out per period by group"}
        showPoints={false}
        smooth
        frame="minimal"
      />
    </div>
  );
}
