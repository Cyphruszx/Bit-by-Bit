/**
 * Dashboard budget rings.
 *
 * The month, the spent map, and group counting are the Budget page's.
 * A category with its own amount is one ring. A group amount is one ring
 * only when that group has no category amounts, so a group plan still shows.
 * Once any category in the group has an amount, the rings are those
 * categories and a higher group amount is not added on top.
 * Unsorted spending is listed spent-only and stays out of the planned total.
 * Overall planned, spent, and left count planned rings only.
 */

import { formatAud } from "@/lib/format";
import {
  budgetGroupLines,
  leftToSpend,
  unsortedSpent,
  type BudgetMonth,
} from "@/lib/money-flow/budget-plan";
import type { CategoryBook } from "@/lib/money-flow/category-book";
import { roundMoney } from "@/lib/money-flow/parse-values";

const wholeDollars = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** In-ring figure. Whole dollars, commas, and `<$1` under a dollar. No sign. */
export function ringMoneyLabel(amount: number): string {
  const abs = Math.abs(amount);
  if (abs > 0 && abs < 1) return "<$1";
  return wholeDollars.format(Math.round(abs));
}

/** Amount plus the left/over word. Over has no plus sign. */
export function ringInsideText(figure: number, over: boolean): string {
  const amount = ringMoneyLabel(figure);
  return over ? `▲ ${amount} over` : `${amount} left`;
}

export function ringSummaryLine(figure: number, over: boolean, planned: number): string {
  const amount = ringMoneyLabel(figure);
  const plan = ringMoneyLabel(planned);
  return over ? `${amount} over of ${plan}` : `${amount} left of ${plan}`;
}

export function categoryRingAria(name: string, spent: number, planned: number): string {
  const left = leftToSpend(planned, spent);
  const word = left.over ? "over" : "left";
  return `${name}, ${formatAud(left.amount)} ${word}, ${formatAud(spent)} of ${formatAud(planned)}`;
}

export function overallRingAria(planned: number, spent: number): string {
  const left = leftToSpend(planned, spent);
  const word = left.over ? "over" : "left";
  return `Budget, ${formatAud(left.amount)} ${word} of ${formatAud(planned)}`;
}

export type PlannedRing = {
  key: string;
  label: string;
  spent: number;
  planned: number;
  remainder: number;
  over: boolean;
};

export type UnplannedSpend = {
  key: string;
  label: string;
  spent: number;
  /** Unsorted has no plan field on the Budget page. */
  settable: boolean;
};

export type DashboardRingCard =
  | { status: "empty" }
  | {
      status: "ready";
      rings: PlannedRing[];
      unplanned: UnplannedSpend[];
      planned: number;
      spent: number;
      remainder: number;
      over: boolean;
      overCount: number;
    };

/** Most over first, then the planned rings closest to their limit. */
export function sortPlannedRings(rings: readonly PlannedRing[]): PlannedRing[] {
  return [...rings].sort((a, b) => {
    if (a.over !== b.over) return a.over ? -1 : 1;
    if (a.over && b.over) return b.remainder - a.remainder || a.label.localeCompare(b.label);
    return a.remainder - b.remainder || a.label.localeCompare(b.label);
  });
}

/** Highest spend first. */
export function sortUnplanned(rows: readonly UnplannedSpend[]): UnplannedSpend[] {
  return [...rows].sort((a, b) => b.spent - a.spent || a.label.localeCompare(b.label));
}

export function budgetStatusNote(overCount: number, unplannedCount: number): string | null {
  const parts: string[] = [];
  if (overCount > 0) parts.push(`${overCount} over budget`);
  if (unplannedCount > 0) parts.push(`Planned categories only · ${unplannedCount} not planned`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ringFrom(key: string, label: string, planned: number, spent: number): PlannedRing {
  const left = leftToSpend(planned, spent);
  return {
    key,
    label,
    spent: left.spent,
    planned: left.planned,
    remainder: left.amount,
    over: left.over,
  };
}

export function dashboardRingCard(
  book: CategoryBook,
  plan: BudgetMonth,
  spentByCategory: ReadonlyMap<string, number>,
  month?: string,
): DashboardRingCard {
  const lines = budgetGroupLines(book, plan, spentByCategory, month);
  const planned: PlannedRing[] = [];
  const unplanned: UnplannedSpend[] = [];

  for (const line of lines) {
    const explicit = line.categories.filter((category) => category.amount != null);
    if (explicit.length === 0 && line.amount != null) {
      planned.push(ringFrom(`group:${line.id}`, line.label, line.counted, line.spent));
      continue;
    }
    for (const category of line.categories) {
      if (category.amount == null) {
        if (category.spent > 0) {
          unplanned.push({
            key: `category:${category.key}`,
            label: category.label,
            spent: category.spent,
            settable: true,
          });
        }
        continue;
      }
      planned.push(ringFrom(`category:${category.key}`, category.label, category.amount, category.spent));
    }
  }

  if (planned.length === 0) return { status: "empty" };

  const loose = unsortedSpent(book, spentByCategory);
  if (loose > 0) {
    unplanned.push({ key: "unsorted", label: "Unsorted", spent: loose, settable: false });
  }

  const plannedTotal = roundMoney(planned.reduce((sum, ring) => sum + ring.planned, 0));
  const spentTotal = roundMoney(planned.reduce((sum, ring) => sum + ring.spent, 0));
  const header = leftToSpend(plannedTotal, spentTotal);
  return {
    status: "ready",
    rings: sortPlannedRings(planned),
    unplanned: sortUnplanned(unplanned),
    planned: header.planned,
    spent: header.spent,
    remainder: header.amount,
    over: header.over,
    overCount: planned.filter((ring) => ring.over).length,
  };
}
