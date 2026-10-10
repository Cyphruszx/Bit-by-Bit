"use client";

import { formatAud, formatAudCompact } from "@/lib/format";
import { CHART_PIXEL, closeSteppedArea, snapChart, steppedPath } from "@/lib/money-flow/chart-pixels";
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
}: {
  series: LineChartSeries[];
  height?: number;
  ariaLabel: string;
  showPoints?: boolean;
}) {
  const labels = sharedLabels(series);
  if (labels.length === 0) {
    return <p className="text-sm text-muted">Nothing to plot yet.</p>;
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
          const path = steppedPath(
            aligned.map((point, index) => (point ? { x: x(index), y: y(point.value) } : undefined)),
          );
          const area = item.fill && path ? closeSteppedArea(path, x(0), y(0)) : null;
          const mark = CHART_PIXEL * 2;
          return (
            <g key={item.id} shapeRendering="crispEdges">
              {area ? <path d={area} fill={item.fill} opacity="0.35" /> : null}
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={CHART_PIXEL}
                  strokeLinejoin="miter"
                  strokeLinecap="square"
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
