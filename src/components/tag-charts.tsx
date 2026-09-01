"use client";

import { useMemo, type ReactNode } from "react";
import { formatAud, formatAudCompact, formatSignedAud } from "@/lib/format";
import { LineChart, type LineChartSeries } from "@/components/line-chart";
import {
  chartTagFlowSeries,
  tagFlowOverTime,
  NO_SUB_TAG,
  type FlowOverTimePoint,
  type TagFlowRow,
} from "@/lib/money-flow/summary";
import {
  barAxisTicks,
  barLayout,
  donutPath,
  nextTagSelection,
  orderByFlow,
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
  const series = useMemo(
    () => (transactions.length > 0 ? chartTagFlowSeries(transactions, selectedTag) : fallbackSeries(categories)),
    [categories, selectedTag, transactions],
  );
  const spend = useMemo(() => orderByFlow(topChartCategories(series.rows)), [series.rows]);
  const slices = useMemo(() => pieSlices(spend), [spend]);
  const timeline = useMemo(() => tagFlowOverTime(transactions, selectedTag), [selectedTag, transactions]);
  const scoped = useMemo(
    () => transactions.filter((txn) => txn.type !== "transfer" && txn.amount !== 0),
    [transactions],
  );
  const primaries = allPrimaryTags(scoped);
  const subs = allSubTags(scoped);
  const highlightAll = series.level === "sub" && series.parent === selectedTag;
  const title =
    series.level === "sub" && series.parent
      ? `${series.parent} · sub-tags`
      : "Money in and out by primary tag";
  const emptyLabel = "No money in or out in this period.";

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
            {chart === "bar"
              ? "Money in sits above the line, money out below."
              : chart === "line"
                ? "Money in minus money out, so the line drops under zero when spending wins."
                : "Slice size is the share of all movement, and money in is outlined."}{" "}
            Totals use the primary tag only, so extra tags never double-count. Tap a primary to see its sub-tags.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["bar", "Bar", "Bar graph"],
              ["line", "Line", "Line graph"],
              ["pie", "Pie", "Pie chart"],
            ] as const
          ).map(([value, short, long]) => (
            <button
              key={value}
              type="button"
              aria-pressed={chart === value}
              onClick={() => onChartChange(value)}
              className={`${toggleClass} ${
                chart === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {compact ? short : long}
            </button>
          ))}
        </div>
      </div>
      {spend.length === 0 ? (
        <p className={`${compact ? "mt-3" : "mt-5"} text-sm text-[#60716a]`}>{emptyLabel}</p>
      ) : chart === "line" ? (
        <FlowLineChart points={timeline} compact={compact} />
      ) : chart === "pie" ? (
        <PieChart
          slices={slices}
          net={series.net}
          selectedTag={selectedTag}
          highlightAll={highlightAll}
          onSelectTag={selectChartTag}
          compact={compact}
        />
      ) : (
        <BarGraph
          categories={spend}
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

/** Demo/summary data only carries spending totals, so treat every category as money out. */
function fallbackSeries(categories: CategorySpend[] = []) {
  const spending = categories.reduce((sum, item) => sum + item.amount, 0);
  const rows: TagFlowRow[] = categories.map((item) => ({
    ...item,
    amount: -item.amount,
    income: 0,
    spending: item.amount,
  }));
  return { rows, level: "primary" as const, income: 0, spending, net: -spending, parent: null };
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
  const zeroY = pad.top + (bars[0]?.zeroY ?? innerHeight);
  const ticks = barAxisTicks(categories);
  const span =
    Math.max(0, ...categories.map((item) => item.amount)) + Math.max(0, ...categories.map((item) => -item.amount));

  return (
    <figure className={`${compact ? "mt-3" : "mt-5"} min-w-0`}>
      <svg
        role="img"
        aria-label="Bar graph of money in and out by tag"
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => {
          const y = span > 0 ? zeroY - (tick / span) * innerHeight : zeroY;
          const isZero = tick === 0;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke={isZero ? "#c3cfc8" : "#edf0ee"}
                strokeWidth="1"
              />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fill="#77857f" fontSize="11">
                {signedCompact(tick)}
              </text>
            </g>
          );
        })}
        {bars.map((bar) => {
          const selected = selectedTag === bar.name;
          const incoming = bar.amount >= 0;
          return (
            <g key={bar.name}>
              <rect
                role="button"
                tabIndex={0}
                aria-label={`${bar.name}: ${formatAud(Math.abs(bar.amount))} ${incoming ? "in" : "out"}`}
                aria-pressed={selected}
                x={pad.left + bar.x}
                y={pad.top + bar.y}
                width={bar.width}
                height={Math.max(bar.height, 0)}
                rx="6"
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

function FlowLineChart({ points, compact = false }: { points: FlowOverTimePoint[]; compact?: boolean }) {
  const series: LineChartSeries[] = [
    {
      id: "net",
      label: "Net (money in minus money out)",
      color: "#173b31",
      points: points.map((point) => ({ key: point.key, label: point.label, value: point.net })),
    },
  ];

  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      <LineChart
        series={series}
        height={compact ? 180 : 240}
        ariaLabel="Line graph of net money in minus money out across the period"
      />
    </div>
  );
}

function signedCompact(amount: number): string {
  if (amount === 0) return "$0";
  return amount > 0 ? `+${formatAudCompact(amount)}` : formatAudCompact(amount);
}

function PieChart({
  slices,
  net,
  selectedTag,
  highlightAll = false,
  onSelectTag,
  compact = false,
}: {
  slices: ReturnType<typeof pieSlices>;
  net: number;
  selectedTag: string;
  highlightAll?: boolean;
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
        aria-label="Pie chart of money in and out by tag"
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
              aria-label={`${slice.name}: ${formatAud(Math.abs(slice.amount))} ${slice.direction}, ${slice.share}%`}
              aria-pressed={selected}
              d={donutPath(cx, cy, outer, inner, slice.startAngle, slice.endAngle)}
              fill={slice.color}
              opacity={active(slice.name) ? 1 : 0.38}
              stroke={slice.direction === "in" ? "#257155" : "transparent"}
              strokeWidth={slice.direction === "in" ? 2 : 0}
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
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill={net >= 0 ? "#257155" : "#173b31"}
          fontSize="13"
          fontWeight="700"
        >
          {signedCompact(net)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#77857f" fontSize="11">
          net
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
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: slice.color,
                      boxShadow: slice.direction === "in" ? "0 0 0 2px #257155" : undefined,
                    }}
                  />
                  <span className="truncate font-medium">{slice.name}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#77857f]">
                    {slice.direction}
                  </span>
                </span>
                <span className={`shrink-0 ${slice.amount >= 0 ? "text-[#257155]" : "text-[#60716a]"}`}>
                  {formatSignedAud(slice.amount)} · {slice.share}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
