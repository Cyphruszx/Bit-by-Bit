"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatAud, formatAudCompact } from "@/lib/format";
import {
  chartTagSeries,
  NO_SUB_TAG,
  type TagFlowDirection,
} from "@/lib/money-flow/summary";
import {
  barLayout,
  donutPath,
  nextTagSelection,
  pieSlices,
  topChartCategories,
  withTagColors,
  type ChartKind,
} from "@/lib/money-flow/tag-charts";
import { allPrimaryTags, allSubTags } from "@/lib/money-flow/tags";
import type { CategorySpend, InterpretedTransaction } from "@/lib/money-flow/types";

export function TagChartCard({
  categories,
  transactions = [],
  selectedTag,
  onSelectTag,
  chart,
  onChartChange,
  compact = false,
}: {
  categories?: CategorySpend[];
  transactions?: InterpretedTransaction[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  chart: ChartKind;
  onChartChange: (chart: ChartKind) => void;
  compact?: boolean;
}) {
  const [direction, setDirection] = useState<TagFlowDirection>("out");
  const series = useMemo(
    () =>
      transactions.length > 0
        ? chartTagSeries(transactions, selectedTag, direction)
        : { rows: categories ?? [], level: "primary" as const, total: (categories ?? []).reduce((sum, item) => sum + item.amount, 0), parent: null },
    [categories, direction, selectedTag, transactions],
  );
  const spend = series.rows;
  const slices = useMemo(() => pieSlices(topChartCategories(spend)), [spend]);
  const scoped = useMemo(
    () =>
      transactions.filter((txn) => (direction === "out" ? txn.amount < 0 && txn.type !== "transfer" : txn.amount > 0 && txn.type !== "transfer")),
    [direction, transactions],
  );
  const primaries = allPrimaryTags(scoped);
  const subs = allSubTags(scoped);
  const highlightAll = series.level === "sub" && series.parent === selectedTag;
  const title =
    direction === "in"
      ? series.level === "sub" && series.parent
        ? `${series.parent} · income sub-tags`
        : "Income by primary tag"
      : series.level === "sub" && series.parent
        ? `${series.parent} · sub-tags`
        : "Spending by primary tag";
  const emptyLabel = direction === "in" ? "No income in this period." : "No spending in this period.";

  function selectChartTag(name: string) {
    if (name === NO_SUB_TAG) return;
    onSelectTag(nextTagSelection(selectedTag, name));
  }

  const toggleClass = compact
    ? "rounded-full px-2.5 py-1 text-xs font-semibold"
    : "rounded-full px-3 py-1.5 text-sm font-semibold";

  return (
    <article className={`rounded-2xl border border-[#dce4df] bg-white ${compact ? "p-4" : "p-6"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className={compact ? "text-base font-bold" : "text-lg font-bold"}>{title}</h2>
          <p className={`text-[#60716a] ${compact ? "mt-0.5 text-xs" : "mt-1 text-sm"}`}>
            Totals use the primary tag only, so extra tags never double-count. Tap a primary to see its sub-tags.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["out", "Spending"],
              ["in", "Income"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
              className={`${toggleClass} ${
                direction === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {label}
            </button>
          ))}
          {(
            [
              ["bar", "Bar"],
              ["pie", "Pie"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={chart === value}
              onClick={() => onChartChange(value)}
              className={`${toggleClass} ${
                chart === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {compact ? label : value === "bar" ? "Bar graph" : "Pie chart"}
            </button>
          ))}
        </div>
      </div>
      {spend.length === 0 ? (
        <p className={`${compact ? "mt-3" : "mt-5"} text-sm text-[#60716a]`}>{emptyLabel}</p>
      ) : chart === "pie" ? (
        <PieChart
          slices={slices}
          spentTotal={series.total}
          selectedTag={selectedTag}
          highlightAll={highlightAll}
          centreLabel={direction === "in" ? "in" : "spent"}
          onSelectTag={selectChartTag}
          compact={compact}
        />
      ) : (
        <BarGraph
          categories={topChartCategories(spend)}
          selectedTag={selectedTag}
          highlightAll={highlightAll}
          onSelectTag={selectChartTag}
          compact={compact}
        />
      )}
      {primaries.length > 0 || subs.length > 0 ? (
        <div className={`${compact ? "mt-3 space-y-2" : "mt-5 space-y-3"}`}>
          <ChipRow label="Primary" compact={compact}>
            <TagToggle active={selectedTag === "All"} onClick={() => onSelectTag("All")} compact={compact}>
              All
            </TagToggle>
            {primaries.map((tag) => (
              <TagToggle
                key={tag}
                active={selectedTag === tag}
                onClick={() => onSelectTag(nextTagSelection(selectedTag, tag))}
                compact={compact}
              >
                {tag}
              </TagToggle>
            ))}
          </ChipRow>
          {subs.length > 0 ? (
            <ChipRow label="Sub-tag" compact={compact}>
              {subs.map((tag) => (
                <TagToggle
                  key={tag}
                  active={selectedTag === tag}
                  onClick={() => onSelectTag(nextTagSelection(selectedTag, tag))}
                  compact={compact}
                >
                  {tag}
                </TagToggle>
              ))}
            </ChipRow>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ChipRow({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#77857f] ${compact ? "w-12" : "w-16"}`}>
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
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full font-semibold ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
        active ? "bg-[#173b31] text-white" : "border border-[#dce4df] bg-white text-[#355a3f]"
      }`}
    >
      {children}
    </button>
  );
}

function BarGraph({
  categories,
  selectedTag,
  highlightAll = false,
  onSelectTag,
  compact = false,
}: {
  categories: CategorySpend[];
  selectedTag: string;
  highlightAll?: boolean;
  onSelectTag: (tag: string) => void;
  compact?: boolean;
}) {
  const width = 640;
  const height = compact ? 168 : 240;
  const pad = compact ? { top: 10, right: 12, bottom: 36, left: 44 } : { top: 16, right: 16, bottom: 48, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const colored = withTagColors(categories);
  const bars = barLayout(colored, innerWidth, innerHeight);
  const maxValue = Math.max(0, ...categories.map((item) => item.amount), 1);
  const ticks = [0, 0.5, 1].map((ratio) => maxValue * ratio);

  return (
    <figure className={`${compact ? "mt-3" : "mt-5"} min-w-0`}>
      <svg
        role="img"
        aria-label="Bar graph of spending by tag"
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => {
          const y = pad.top + innerHeight - (tick / maxValue) * innerHeight;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#edf0ee" strokeWidth="1" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="#77857f" fontSize="11">
                {formatAudCompact(tick)}
              </text>
            </g>
          );
        })}
        {bars.map((bar) => {
          const selected = selectedTag === bar.name;
          return (
            <g key={bar.name}>
              <rect
                role="button"
                tabIndex={0}
                aria-label={`${bar.name}: ${formatAud(bar.amount)}`}
                aria-pressed={selected}
                x={pad.left + bar.x}
                y={pad.top + bar.y}
                width={bar.width}
                height={Math.max(bar.height, 0)}
                rx="8"
                fill={bar.color}
                opacity={highlightAll || selectedTag === "All" || selected ? 1 : 0.38}
                className="cursor-pointer"
                onClick={() => onSelectTag(bar.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectTag(bar.name);
                  }
                }}
              />
              <text
                x={pad.left + bar.x + bar.width / 2}
                y={height - 14}
                textAnchor="middle"
                fill="#77857f"
                fontSize="11"
              >
                {bar.name}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function PieChart({
  slices,
  spentTotal,
  selectedTag,
  highlightAll = false,
  centreLabel,
  onSelectTag,
  compact = false,
}: {
  slices: ReturnType<typeof pieSlices>;
  spentTotal: number;
  selectedTag: string;
  highlightAll?: boolean;
  centreLabel: string;
  onSelectTag: (tag: string) => void;
  compact?: boolean;
}) {
  const size = compact ? 220 : 280;
  const cx = size / 2;
  const cy = size / 2;
  const outer = compact ? 84 : 108;
  const inner = compact ? 50 : 64;
  const active = (name: string) => highlightAll || selectedTag === "All" || selectedTag === name;

  return (
    <div
      className={`grid md:items-center ${
        compact ? "mt-3 gap-4 md:grid-cols-[220px_1fr]" : "mt-5 gap-6 md:grid-cols-[280px_1fr]"
      }`}
    >
      <svg
        role="img"
        aria-label="Pie chart of spending by tag"
        viewBox={`0 0 ${size} ${size}`}
        className={`mx-auto h-auto w-full ${compact ? "max-w-[220px]" : "max-w-[280px]"}`}
      >
        {slices.map((slice) => {
          const selected = selectedTag === slice.name;
          return (
            <path
              key={slice.name}
              role="button"
              tabIndex={0}
              aria-label={`${slice.name}: ${formatAud(slice.amount)}, ${slice.share}%`}
              aria-pressed={selected}
              d={donutPath(cx, cy, outer, inner, slice.startAngle, slice.endAngle)}
              fill={slice.color}
              opacity={active(slice.name) ? 1 : 0.38}
              className="cursor-pointer"
              onClick={() => onSelectTag(slice.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTag(slice.name);
                }
              }}
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#173b31" fontSize="13" fontWeight="700">
          {formatAudCompact(spentTotal)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#77857f" fontSize="11">
          {centreLabel}
        </text>
      </svg>
      <ul className={compact ? "space-y-0.5" : "space-y-2"}>
        {slices.map((slice) => {
          const selected = selectedTag === slice.name;
          return (
            <li key={slice.name}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectTag(slice.name)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl text-left ${
                  compact ? "px-2 py-1 text-xs" : "rounded-2xl px-3 py-2 text-sm"
                } ${selected ? "bg-[#edf4dc]" : ""}`}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
                  <span className="truncate font-medium">{slice.name}</span>
                </span>
                <span className="shrink-0 text-[#60716a]">
                  {formatAud(slice.amount)} · {slice.share}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
