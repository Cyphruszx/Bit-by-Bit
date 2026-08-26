"use client";

import { formatAud, formatAudCompact } from "@/lib/format";
import type { ChartPoint } from "@/lib/money-flow/savings";

export type LineChartSeries = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  fill?: string;
  points: ChartPoint[];
};

const POT_COLORS = ["#173b31", "#73a883", "#5b8a9a", "#c4a35a", "#8b6b9b", "#9b3b32"];

export function potLineColor(index: number) {
  return POT_COLORS[index % POT_COLORS.length];
}

export function LineChart({
  series,
  height = 240,
  ariaLabel,
}: {
  series: LineChartSeries[];
  height?: number;
  ariaLabel: string;
}) {
  const labels = sharedLabels(series);
  if (labels.length === 0) {
    return <p className="text-sm text-[#60716a]">Nothing to plot yet.</p>;
  }

  const width = 640;
  const pad = { top: 16, right: 16, bottom: 36, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const maxValue = niceMax(Math.max(0, ...values));
  const minValue = 0;
  const x = (index: number) =>
    pad.left + (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
  const y = (value: number) =>
    pad.top + innerHeight - ((value - minValue) / Math.max(maxValue - minValue, 1)) * innerHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);
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
              stroke="#edf0ee"
              strokeWidth="1"
            />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fill="#77857f" fontSize="11">
              {formatAudCompact(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % xLabelEvery === 0 || index === labels.length - 1 ? (
            <text
              key={`${label.key}-${index}`}
              x={x(index)}
              y={height - 10}
              textAnchor="middle"
              fill="#77857f"
              fontSize="11"
            >
              {label.label}
            </text>
          ) : null,
        )}
        {series.map((item) => {
          const aligned = labels.map((label) => item.points.find((point) => point.key === label.key));
          const path = toPath(aligned, x, y);
          const area = item.fill && path ? `${path} L ${x(labels.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z` : null;
          return (
            <g key={item.id}>
              {area ? <path d={area} fill={item.fill} opacity="0.35" /> : null}
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={item.dashed ? "6 6" : undefined}
                />
              ) : null}
              {aligned.map((point, index) =>
                point ? (
                  <circle key={`${item.id}-${point.key}`} cx={x(index)} cy={y(point.value)} r="3.5" fill={item.color}>
                    <title>
                      {item.label}: {formatAud(point.value)} · {point.label}
                    </title>
                  </circle>
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[#52625c]">
        {series.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded-full"
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

function toPath(
  points: Array<ChartPoint | undefined>,
  x: (index: number) => number,
  y: (value: number) => number,
) {
  const commands: string[] = [];
  points.forEach((point, index) => {
    if (!point) return;
    commands.push(`${commands.length === 0 ? "M" : "L"} ${x(index)} ${y(point.value)}`);
  });
  return commands.length ? commands.join(" ") : "";
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const n = value / magnitude;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * magnitude;
}
