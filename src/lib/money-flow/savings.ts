import { goals as demoGoals } from "@/lib/demo-data";
import { roundMoney } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type SavingsPot = {
  id: string;
  name: string;
  detail: string;
  saved: number;
  target: number;
  monthlyContribution: number;
  includedInTotal?: boolean;
};

export type SavingsSnapshot = {
  date: string;
  totalSaved: number;
};

export type ChartPoint = {
  key: string;
  label: string;
  value: number;
};

export type NamedChartSeries = {
  id: string;
  name: string;
  points: ChartPoint[];
};

export function seedSavingsPots(): SavingsPot[] {
  return demoGoals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    detail: goal.detail,
    saved: goal.saved,
    target: goal.target,
    monthlyContribution: goal.monthlyContribution,
  }));
}

export function monthsToPot(pot: SavingsPot): number | null {
  const remaining = pot.target - pot.saved;
  if (remaining <= 0) return 0;
  if (pot.monthlyContribution <= 0) return null;
  return Math.ceil(remaining / pot.monthlyContribution);
}

export function isIncludedInTotal(pot: SavingsPot): boolean {
  return pot.includedInTotal !== false;
}

export function potsInTotal(pots: SavingsPot[]): SavingsPot[] {
  return pots.filter(isIncludedInTotal);
}

export function nextIncludedInTotal(pot: SavingsPot): boolean {
  return !isIncludedInTotal(pot);
}

export function localIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthLabelFromKey(key: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month] = key.split("-").map(Number);
  const name = months[(month ?? 1) - 1] ?? "Jan";
  return `${name} ${year}`;
}

export function recordSavingsSnapshot(
  pots: SavingsPot[],
  snapshots: SavingsSnapshot[],
  todayIso: string,
): SavingsSnapshot[] {
  const totalSaved = roundMoney(pots.reduce((sum, pot) => sum + pot.saved, 0));
  const next = { date: todayIso, totalSaved };
  const last = snapshots[snapshots.length - 1];
  if (last?.date === todayIso) {
    if (last.totalSaved === totalSaved) return snapshots;
    return [...snapshots.slice(0, -1), next];
  }
  if (last && last.totalSaved === totalSaved) return snapshots;
  return [...snapshots, next].slice(-120);
}

export function projectedSavingsPath(
  pots: SavingsPot[],
  options: { fromIso: string; minMonths?: number; maxMonths?: number },
): ChartPoint[] {
  if (pots.length === 0) return [];
  const minMonths = options.minMonths ?? 6;
  const maxMonths = options.maxMonths ?? 18;
  const totalSaved = roundMoney(pots.reduce((sum, pot) => sum + pot.saved, 0));
  const totalTarget = roundMoney(pots.reduce((sum, pot) => sum + pot.target, 0));
  const monthly = roundMoney(pots.reduce((sum, pot) => sum + pot.monthlyContribution, 0));
  const monthsToTarget =
    monthly > 0 && totalSaved < totalTarget ? Math.ceil((totalTarget - totalSaved) / monthly) + 1 : minMonths;
  const count = Math.min(maxMonths, Math.max(minMonths, monthsToTarget));
  const cap = totalTarget > 0 ? totalTarget : Number.POSITIVE_INFINITY;
  let balance = totalSaved;
  const points: ChartPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = shiftMonthKey(options.fromIso.slice(0, 7), index);
    points.push({
      key,
      label: monthLabelFromKey(key),
      value: roundMoney(Math.min(balance, cap)),
    });
    balance = roundMoney(balance + monthly);
  }
  return points;
}

export function projectedPotSeries(
  pots: SavingsPot[],
  options: { fromIso: string; minMonths?: number; maxMonths?: number },
): NamedChartSeries[] {
  const template = projectedSavingsPath(pots, options);
  return pots.map((pot) => {
    const cap = pot.target > 0 ? pot.target : Number.POSITIVE_INFINITY;
    let balance = pot.saved;
    const points = template.map((point) => {
      const value = roundMoney(Math.min(balance, cap));
      balance = roundMoney(balance + pot.monthlyContribution);
      return { ...point, value };
    });
    return { id: pot.id, name: pot.name, points };
  });
}

export function savingsProgressSeries(
  pots: SavingsPot[],
  snapshots: SavingsSnapshot[],
  options: { fromIso: string; minMonths?: number; maxMonths?: number },
): { saved: ChartPoint[]; target: ChartPoint[] } {
  const projected = projectedSavingsPath(pots, options);
  const saved = prependRecordedMonths(snapshots, projected);
  const targetAmount = roundMoney(pots.reduce((sum, pot) => sum + pot.target, 0));
  const target = saved.map((point) => ({ ...point, value: targetAmount }));
  return { saved, target };
}

export function prependRecordedMonths(snapshots: SavingsSnapshot[], projected: ChartPoint[]): ChartPoint[] {
  if (projected.length === 0) return [];
  const firstKey = projected[0].key;
  const latestByMonth = new Map<string, SavingsSnapshot>();
  for (const snapshot of snapshots) {
    const key = snapshot.date.slice(0, 7);
    if (key < firstKey) latestByMonth.set(key, snapshot);
  }
  const past = [...latestByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, snapshot]) => ({
      key,
      label: monthLabelFromKey(key),
      value: snapshot.totalSaved,
    }));
  return [...past, ...projected];
}

export function monthlyTransferSeries(transactions: InterpretedTransaction[]): ChartPoint[] {
  const byMonth = new Map<string, number>();
  for (const txn of transactions) {
    if (txn.type !== "transfer" || !txn.dateIso) continue;
    const key = txn.dateIso.slice(0, 7);
    if (key.length !== 7) continue;
    byMonth.set(key, roundMoney((byMonth.get(key) ?? 0) + Math.abs(txn.amount)));
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: monthLabelFromKey(key),
      value,
    }));
}

function shiftMonthKey(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return shifted.toISOString().slice(0, 7);
}
