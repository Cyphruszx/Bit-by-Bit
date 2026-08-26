"use client";

import { useMemo } from "react";
import { formatAud, formatAudCompact } from "@/lib/format";
import {
  barLayout,
  donutPath,
  nextTagSelection,
  pieSlices,
  topChartCategories,
  withTagColors,
  type ChartKind,
} from "@/lib/money-flow/tag-charts";
import { allTags } from "@/lib/money-flow/tags";
import type { CategorySpend, InterpretedTransaction } from "@/lib/money-flow/types";

export function TagChartCard({
  categories,
  transactions,
  selectedTag,
  onSelectTag,
  chart,
  onChartChange,
  title = "Spending by tag",
}: {
  categories: CategorySpend[];
  transactions?: InterpretedTransaction[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  chart: ChartKind;
  onChartChange: (chart: ChartKind) => void;
  title?: string;
}) {
  const slices = useMemo(() => pieSlices(topChartCategories(categories)), [categories]);
  const tags = transactions ? allTags(transactions) : categories.map((item) => item.name);

  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-[#60716a]">Toggle bar or pie, then tap a tag to show those transactions.</p>
        </div>
        <div className="flex gap-1">
          {(
            [
              ["bar", "Bar graph"],
              ["pie", "Pie chart"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={chart === value}
              onClick={() => onChartChange(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                chart === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {categories.length === 0 ? (
        <p className="mt-5 text-sm text-[#60716a]">No spending in this period.</p>
      ) : chart === "pie" ? (
        <PieChart slices={slices} selectedTag={selectedTag} onSelectTag={onSelectTag} />
      ) : (
        <BarGraph categories={topChartCategories(categories)} selectedTag={selectedTag} onSelectTag={onSelectTag} />
      )}
      {tags.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <TagToggle active={selectedTag === "All"} onClick={() => onSelectTag("All")}>
            All tags
          </TagToggle>
          {tags.map((tag) => (
            <TagToggle key={tag} active={selectedTag === tag} onClick={() => onSelectTag(nextTagSelection(selectedTag, tag))}>
              {tag}
            </TagToggle>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TagToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
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
  onSelectTag,
}: {
  categories: CategorySpend[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
}) {
  const width = 640;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 48, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const colored = withTagColors(categories);
  const bars = barLayout(colored, innerWidth, innerHeight);
  const maxValue = Math.max(0, ...categories.map((item) => item.amount), 1);
  const ticks = [0, 0.5, 1].map((ratio) => maxValue * ratio);

  return (
    <figure className="mt-5 min-w-0">
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
                opacity={selectedTag === "All" || selected ? 1 : 0.38}
                className="cursor-pointer"
                onClick={() => onSelectTag(nextTagSelection(selectedTag, bar.name))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectTag(nextTagSelection(selectedTag, bar.name));
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
  selectedTag,
  onSelectTag,
}: {
  slices: ReturnType<typeof pieSlices>;
  selectedTag: string;
  onSelectTag: (tag: string) => void;
}) {
  const size = 280;
  const cx = 140;
  const cy = 140;
  const outer = 108;
  const inner = 64;
  const total = slices.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[280px_1fr] md:items-center">
      <svg
        role="img"
        aria-label="Pie chart of spending by tag"
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-auto w-full max-w-[280px]"
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
              opacity={selectedTag === "All" || selected ? 1 : 0.38}
              className="cursor-pointer"
              onClick={() => onSelectTag(nextTagSelection(selectedTag, slice.name))}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectTag(nextTagSelection(selectedTag, slice.name));
                }
              }}
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#173b31" fontSize="13" fontWeight="700">
          {formatAudCompact(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#77857f" fontSize="11">
          spent
        </text>
      </svg>
      <ul className="space-y-2">
        {slices.map((slice) => {
          const selected = selectedTag === slice.name;
          return (
            <li key={slice.name}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectTag(nextTagSelection(selectedTag, slice.name))}
                className={`flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm ${
                  selected ? "bg-[#edf4dc]" : ""
                }`}
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
