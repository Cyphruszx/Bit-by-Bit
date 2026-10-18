"use client";

import { formatAud, formatAudCompact } from "@/lib/format";
import { chartScale, formatChartAxis } from "@/lib/money-flow/chart-range";
import { CHART_PIXEL, closeSteppedArea, smoothPath, snapChart, steppedPath } from "@/lib/money-flow/chart-pixels";
import type { ChartPoint } from "@/lib/money-flow/savings";

export type LineChartSeries = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  fill?: string;
  points: ChartPoint[];
};

const POT_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-chart-6)"];

export function potLineColor(index: number) {
  return POT_COLORS[index % POT_COLORS.length];
}

export function LineChart({
  series,
  height = 240,
  ariaLabel,
  showPoints = true,
  smooth = false,
  frame = "standard",
}: {
  series: LineChartSeries[];
  height?: number;
  ariaLabel: string;
  showPoints?: boolean;
  /** Monotone curve. Savings charts stay on the stepped pixel line. */
  smooth?: boolean;
  /** Transactions uses three labels and a $0 baseline. Savings keeps the full axis. */
  frame?: "standard" | "minimal";
}) {
  const labels = sharedLabels(series);
  if (labels.length === 0) {
    return <p className="text-sm text-muted">Nothing to plot yet.</p>;
  }
  if (frame === "minimal") {
    return <MinimalChart series={series} height={height} ariaLabel={ariaLabel} smooth={smooth} />;
  }

  const width = 640;
  const pad = { top: 16, right: 16, bottom: 36, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const lowest = Math.min(0, ...values);
  const maxValue = niceMax(Math.max(0, ...values));
  const minValue = lowest < 0 ? -niceMax(-lowest) : 0;
  const x = (index: number) =>
    snapChart(
      pad.left + (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth),
    );
  const y = (value: number) =>
    snapChart(pad.top + innerHeight - ((value - minValue) / Math.max(maxValue - minValue, 1)) * innerHeight);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minValue + (maxValue - minValue) * ratio);
  const xLabelEvery = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <figure className="min-w-0">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick, index) => (
          <g key={index}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-surface-subtle)"
              strokeWidth={CHART_PIXEL / 2}
              shapeRendering="crispEdges"
            />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fill="var(--color-muted)" fontSize="11">
              {formatAudCompact(tick)}
            </text>
          </g>
        ))}
        {minValue < 0 ? (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--color-axis)"
            strokeWidth={CHART_PIXEL / 2}
            shapeRendering="crispEdges"
          />
        ) : null}
        {labels.map((label, index) =>
          index % xLabelEvery === 0 || index === labels.length - 1 ? (
            <text
              key={`${label.key}-${index}`}
              x={x(index)}
              y={height - 10}
              textAnchor="middle"
              fill="var(--color-muted)"
              fontSize="11"
            >
              {label.label}
            </text>
          ) : null,
        )}
        {series.map((item) => {
          const aligned = labels.map((label) => item.points.find((point) => point.key === label.key));
          const plotted = aligned.map((point, index) => (point ? { x: x(index), y: y(point.value) } : undefined));
          const path = smooth ? smoothPath(plotted) : steppedPath(plotted);
          const area = item.fill && path ? closeSteppedArea(path, x(0), y(0)) : null;
          const mark = CHART_PIXEL * 2;
          return (
            <g key={item.id} shapeRendering={smooth ? "geometricPrecision" : "crispEdges"}>
              {area ? <path d={area} fill={item.fill} opacity="0.35" /> : null}
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={CHART_PIXEL}
                  strokeLinejoin={smooth ? "round" : "miter"}
                  strokeLinecap={smooth ? "round" : "square"}
                  strokeDasharray={item.dashed ? `${CHART_PIXEL} ${CHART_PIXEL}` : undefined}
                />
              ) : null}
              {showPoints
                ? aligned.map((point, index) =>
                    point ? (
                      <rect
                        key={`${item.id}-${point.key}`}
                        x={x(index) - mark / 2}
                        y={y(point.value) - mark / 2}
                        width={mark}
                        height={mark}
                        fill={item.color}
                        aria-label={`${item.label}: ${formatAud(point.value)} · ${point.label}`}
                      />
                    ) : null,
                  )
                : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
        {series.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-1 w-5 rounded-none"
              style={{
                background: item.dashed ? "transparent" : item.color,
                borderTop: item.dashed ? `2px dashed ${item.color}` : undefined,
              }}
            />
            {item.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function MinimalChart({
  series,
  height,
  ariaLabel,
  smooth,
}: {
  series: LineChartSeries[];
  height: number;
  ariaLabel: string;
  smooth: boolean;
}) {
  const labels = sharedLabels(series);
  const plotWidth = 640;
  const pad = { top: 12, right: 2, bottom: 30 };
  const innerWidth = plotWidth - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const scale = chartScale(Math.max(0, ...values));
  const maxValue = scale.max;
  const x = (index: number) => (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
  const y = (value: number) => pad.top + innerHeight - (value / Math.max(maxValue, 1)) * innerHeight;
  const ticks = [scale.max, scale.mid, 0];
  const xLabelEvery = Math.max(1, Math.ceil(labels.length / 5));
  const dateIndexes = labels
    .map((_, index) => index)
    .filter((index) => index % xLabelEvery === 0 || index === labels.length - 1);

  return (
    <figure className="min-w-0">
      <div className="flex gap-2" style={{ height }}>
        <div className="relative w-11 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-right font-sans text-[11px] leading-none text-muted"
              style={{ top: `${(y(tick) / height) * 100}%` }}
            >
              {formatChartAxis(tick)}
            </span>
          ))}
        </div>
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${plotWidth} ${height}`}
          preserveAspectRatio="none"
          className="h-full min-w-0 flex-1 overflow-visible"
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={innerWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-line)"
              strokeOpacity={tick === 0 ? 0.8 : 0.3}
              strokeWidth={1}
              shapeRendering="geometricPrecision"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((item) => {
            const aligned = labels.map((label) => item.points.find((point) => point.key === label.key));
            const plotted = aligned.map((point, index) => (point ? { x: x(index), y: y(point.value) } : undefined));
            const path = smooth ? smoothPath(plotted) : steppedPath(plotted);
            return (
              <g key={item.id} shapeRendering={smooth ? "geometricPrecision" : "crispEdges"}>
                {path ? (
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={CHART_PIXEL}
                    strokeLinejoin={smooth ? "round" : "miter"}
                    strokeLinecap={smooth ? "round" : "square"}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex gap-2">
        <div className="w-11 shrink-0" aria-hidden="true" />
        <div className="relative h-4 min-w-0 flex-1 font-sans text-[11px] leading-none text-muted">
          {dateIndexes.map((index) => {
            const label = labels[index];
            if (!label) return null;
            const atStart = index === 0;
            const atEnd = index === labels.length - 1;
            return (
              <span
                key={`${label.key}-${index}`}
                className={`absolute top-0 whitespace-nowrap ${atStart ? "" : atEnd ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${(x(index) / innerWidth) * 100}%` }}
              >
                {label.label}
              </span>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

function sharedLabels(series: LineChartSeries[]) {
  const seen = new Map<string, string>();
  for (const item of series) {
    for (const point of item.points) {
      if (!seen.has(point.key)) seen.set(point.key, point.label);
    }
  }
  return [...seen.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, label]) => ({ key, label }));
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const n = value / magnitude;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * magnitude;
}
