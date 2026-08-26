"use client";

import { LineChart, potLineColor, type LineChartSeries } from "@/components/line-chart";
import { formatAud } from "@/lib/format";
import {
  localIsoDate,
  monthlyTransferSeries,
  projectedPotSeries,
  savingsProgressSeries,
  type SavingsPot,
  type SavingsSnapshot,
} from "@/lib/money-flow/savings";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export function SavingsPathChart({
  pots,
  snapshots,
  compact = false,
}: {
  pots: SavingsPot[];
  snapshots: SavingsSnapshot[];
  compact?: boolean;
}) {
  if (pots.length === 0) {
    return <p className="text-sm text-[#60716a]">Include a pot to see the path to target.</p>;
  }

  const fromIso = localIsoDate();
  const { saved, target } = savingsProgressSeries(pots, snapshots, { fromIso });
  const series: LineChartSeries[] = [
    {
      id: "saved",
      label: snapshots.length > 1 ? "Saved (recorded + planned)" : "Saved (planned path)",
      color: "#173b31",
      fill: "#d5f06c",
      points: saved,
    },
    {
      id: "target",
      label: `Target ${formatAud(target[0]?.value ?? 0)}`,
      color: "#73a883",
      dashed: true,
      points: target,
    },
  ];

  return (
    <LineChart
      series={series}
      height={compact ? 180 : 260}
      ariaLabel="Line graph of combined savings toward the target"
    />
  );
}

export function SavingsPotLinesChart({
  pots,
  colorFrom,
}: {
  pots: SavingsPot[];
  colorFrom?: SavingsPot[];
}) {
  if (pots.length === 0) return null;
  const palette = colorFrom ?? pots;
  const series = projectedPotSeries(pots, { fromIso: localIsoDate() }).map((item) => ({
    id: item.id,
    label: item.name,
    color: potLineColor(Math.max(0, palette.findIndex((pot) => pot.id === item.id))),
    points: item.points,
  }));
  return <LineChart series={series} height={240} ariaLabel="Line graph of each savings pot over coming months" />;
}

export function SetAsideLineChart({ transactions }: { transactions: InterpretedTransaction[] }) {
  const points = monthlyTransferSeries(transactions);
  if (points.length < 2) return null;
  return (
    <LineChart
      series={[
        {
          id: "set-aside",
          label: "Set aside",
          color: "#173b31",
          fill: "#d5f06c",
          points,
        },
      ]}
      height={200}
      ariaLabel="Line graph of money set aside by month"
    />
  );
}
