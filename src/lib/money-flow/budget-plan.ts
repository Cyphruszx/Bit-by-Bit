/**
 * Budget v1 plan (BV.A.2b nested amounts, BV.A.2c page maths).
 *
 * A group counts once. The figure used for Left to plan and Left to spend is the
 * larger of the typed group amount and the sum of its category amounts. A blank
 * group counts that category total. Category amounts are never added on top.
 *
 * The Budget page leaves out Income, Unsorted (and the old Other group), and
 * Transfers. Unsorted spending is shown on its own and stays out of Spent,
 * Left to plan, and Left to spend. Investing and Debt Payments stay in Money
 * moves and count in all three. Transfers never counts as Spent. Unsorted stays
 * out of the planned total. The dashboard ring card reads this same month:
 * a category amount is a ring, and a group amount is one ring when that group
 * has no category amounts.
 */

import { categoriesIn, type BookCategory, type CategoryBook } from "@/lib/money-flow/category-book";
import { APP_TIME_ZONE } from "@/lib/money-flow/period";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { categoryOf } from "@/lib/money-flow/tags";
import { tileAmount } from "@/lib/money-flow/tile";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import type { Ledger } from "@/lib/money-flow/ledger";

/** Group cards the Budget page does not draw. Their stored amounts are ignored. */
const OFF_BUDGET_GROUPS = new Set(["income", "unsorted", "misc", "transfers"]);

/** Spending that is listed, not planned. The old Other group uses the same row. */
const UNSORTED_GROUPS = new Set(["unsorted", "misc"]);

/** Transfers never counts as Spent, on this page or inside Money moves. */
const OFF_BUDGET_CATEGORIES = new Set(["transfers"]);

export type BudgetMonth = {
  /** Expected income for this month. Absent means not set. */
  income?: number;
  /** Typed group amounts. A missing key is a blank field. */
  groups: Record<string, number>;
  /** Typed category amounts. A missing key is a blank field. */
  categories: Record<string, number>;
};

export type BudgetBook = {
  months: Record<string, BudgetMonth>;
};

export type LeftToPlan =
  | { status: "unset"; planned: number }
  | { status: "left"; amount: number; planned: number; income: number }
  | { status: "over"; amount: number; planned: number; income: number };

export type LeftToSpend = {
  /** Planned minus spent. Positive means money still to spend. */
  amount: number;
  over: boolean;
  planned: number;
  spent: number;
};

export type RingRead = {
  /** 0–1. A full ring is 1. Both-zero draws no progress stroke. */
  fill: number;
  /** Planned and spent are both zero: an empty outline. */
  empty: boolean;
  over: boolean;
  /** Dollars still left, or dollars over. */
  figure: number;
};

const MONTH_KEY = /^\d{4}-\d{2}$/;

export function emptyBudgetBook(): BudgetBook {
  return { months: {} };
}

export function monthPlan(book: BudgetBook, month: string): BudgetMonth {
  return book.months[month] ?? { groups: {}, categories: {} };
}

/** Sum of the typed category amounts. Blank categories add nothing. */
export function categoryTotal(amounts: readonly (number | null | undefined)[]): number {
  return roundMoney(amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0));
}

/**
 * What one group contributes.
 * Blank group → category total. Both filled → the larger of the two.
 */
export function countedGroupAmount(
  groupAmount: number | null | undefined,
  categoryAmounts: readonly (number | null | undefined)[],
): number {
  const categories = categoryTotal(categoryAmounts);
  if (groupAmount == null) return categories;
  return roundMoney(Math.max(groupAmount, categories));
}

/** Category total when the typed group amount is below it, otherwise nothing to warn about. */
export function groupShortfall(
  groupAmount: number | null | undefined,
  categoryAmounts: readonly (number | null | undefined)[],
): number | null {
  if (groupAmount == null) return null;
  const categories = categoryTotal(categoryAmounts);
  if (groupAmount < categories) return categories;
  return null;
}

/** Expected income minus every group's counted amount. Income not set stays unset. */
export function leftToPlan(income: number | null | undefined, countedPlanned: number): LeftToPlan {
  const planned = roundMoney(countedPlanned);
  if (income == null) return { status: "unset", planned };
  const delta = roundMoney(income - planned);
  if (delta < 0) return { status: "over", amount: roundMoney(-delta), planned, income };
  return { status: "left", amount: delta, planned, income };
}

/** Total counted plan minus total spent. Negative reads as over. */
export function leftToSpend(planned: number, spent: number): LeftToSpend {
  const delta = roundMoney(planned - spent);
  if (delta < 0) {
    return { amount: roundMoney(-delta), over: true, planned: roundMoney(planned), spent: roundMoney(spent) };
  }
  return { amount: delta, over: false, planned: roundMoney(planned), spent: roundMoney(spent) };
}

/**
 * Ring fill is Spent ÷ Planned.
 * Over, or planned $0 with spending: full, and the figure is the over amount.
 * Both $0: empty outline, $0 left.
 */
export function ringRead(planned: number, spent: number): RingRead {
  const plan = roundMoney(planned);
  const used = roundMoney(spent);
  if (plan === 0 && used === 0) return { fill: 0, empty: true, over: false, figure: 0 };
  if (used > plan) return { fill: 1, empty: false, over: true, figure: roundMoney(used - plan) };
  return { fill: plan > 0 ? used / plan : 0, empty: false, over: false, figure: roundMoney(plan - used) };
}

export type BudgetCategoryLine = {
  key: string;
  label: string;
  spent: number;
  amount: number | null;
};

export type BudgetGroupLine = {
  id: string;
  label: string;
  spent: number;
  /** What was typed. Null is a blank field. */
  amount: number | null;
  /** Blank fields display this — the category total. */
  categorySum: number;
  counted: number;
  /** Category total while the typed group amount is too small. */
  shortfall: number | null;
  categories: BudgetCategoryLine[];
  ring: RingRead;
};

/** Sydney calendar month for an archive timestamp, so "next month" follows the app clock. */
export function planMonthOf(when: string | Date): string {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
}

/**
 * An archived category stays in the plan for the month it was archived and earlier.
 * Later months drop it. Callers that do not name a month keep every category, so
 * existing plan maths is unchanged until a page passes the month it is showing.
 */
function shownInPlan(category: BookCategory, month: string | undefined): boolean {
  if (!category.archivedAt || !month) return true;
  const archivedMonth = planMonthOf(category.archivedAt);
  if (!archivedMonth) return true;
  return archivedMonth >= month;
}

export function budgetGroupLines(
  book: CategoryBook,
  plan: BudgetMonth,
  spentByCategory: ReadonlyMap<string, number>,
  month?: string,
): BudgetGroupLine[] {
  return book.groups.flatMap((group) => {
    if (OFF_BUDGET_GROUPS.has(group.id)) return [];
    const held = categoriesIn(book, group.id).filter((category) => shownInPlan(category, month));
    const visible = held.filter((category) => !OFF_BUDGET_CATEGORIES.has(category.key));
    if (held.length > 0 && visible.length === 0) return [];
    const categories = visible.map((category) => ({
      key: category.key,
      label: category.label,
      spent: roundMoney(spentByCategory.get(category.key) ?? 0),
      amount: plan.categories[category.key] ?? null,
    }));
    const amounts = categories.map((category) => category.amount);
    const typed = plan.groups[group.id] ?? null;
    const counted = countedGroupAmount(typed, amounts);
    const spent = roundMoney(categories.reduce((sum, category) => sum + category.spent, 0));
    return [
      {
        id: group.id,
        label: group.label,
        spent,
        amount: typed,
        categorySum: categoryTotal(amounts),
        counted,
        shortfall: groupShortfall(typed, amounts),
        categories,
        ring: ringRead(counted, spent),
      },
    ];
  });
}

/** Unsorted spending for the footer. It is not part of {@link planTotals}. */
export function unsortedSpent(book: CategoryBook, spentByCategory: ReadonlyMap<string, number>): number {
  const keys = book.groups
    .filter((group) => UNSORTED_GROUPS.has(group.id))
    .flatMap((group) => categoriesIn(book, group.id).map((category) => category.key));
  return roundMoney(keys.reduce((sum, key) => sum + (spentByCategory.get(key) ?? 0), 0));
}

export function planTotals(lines: readonly BudgetGroupLine[]): { planned: number; spent: number } {
  return {
    planned: roundMoney(lines.reduce((sum, line) => sum + line.counted, 0)),
    spent: roundMoney(lines.reduce((sum, line) => sum + line.spent, 0)),
  };
}

export type DashboardBudgetTile = {
  id: string;
  label: string;
  /** Unsorted is listed spent only: no plan, and no left or over. */
  kind: "group" | "unsorted";
  spent: number;
  /**
   * The group's planned amount: spent + left, or spent − over.
   * Absent on Unsorted.
   */
  planned?: number;
  /** Dollars still left, or dollars over. Absent on Unsorted. */
  remainder?: number;
  over?: boolean;
};

export type DashboardBudgetCard = {
  tiles: DashboardBudgetTile[];
  spent: number;
  planned: number;
  remainder: number;
  over: boolean;
};

/**
 * Read-only dashboard Budget card.
 * Group plans are the counted amounts. Their sum is the header planned total.
 * Unsorted is appended only when it has spending, and it is left out of both totals.
 */
export function dashboardBudgetCard(
  book: CategoryBook,
  plan: BudgetMonth,
  spentByCategory: ReadonlyMap<string, number>,
  month?: string,
): DashboardBudgetCard {
  const lines = budgetGroupLines(book, plan, spentByCategory, month);
  const tiles: DashboardBudgetTile[] = lines.map((line) => {
    const left = leftToSpend(line.counted, line.spent);
    const planned = left.over ? roundMoney(line.spent - left.amount) : roundMoney(line.spent + left.amount);
    return {
      id: line.id,
      label: line.label,
      kind: "group",
      spent: line.spent,
      planned,
      remainder: left.amount,
      over: left.over,
    };
  });
  const loose = unsortedSpent(book, spentByCategory);
  if (loose > 0) {
    tiles.push({ id: "unsorted", label: "Unsorted", kind: "unsorted", spent: loose });
  }
  const totals = planTotals(lines);
  const header = leftToSpend(totals.planned, totals.spent);
  return {
    tiles,
    spent: header.spent,
    planned: header.planned,
    remainder: header.amount,
    over: header.over,
  };
}

/**
 * Debits for the Budget page, keyed by category.
 * Transfers are left out. Investing and Debt Payments are kept.
 * Income and Unsorted stay in the map so the page can read them, and the
 * group list leaves both out of Spent.
 */
export function spentByCategoryKey(transactions: readonly InterpretedTransaction[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const txn of transactions) {
    if (tileAmount(txn) >= 0) continue;
    const key = categoryOf(txn);
    if (OFF_BUDGET_CATEGORIES.has(key)) continue;
    totals.set(key, roundMoney((totals.get(key) ?? 0) + Math.abs(tileAmount(txn))));
  }
  return totals;
}

export function parseMoneyInput(raw: string): number | null | "invalid" {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  if (!/^\d*\.?\d+$/.test(cleaned)) return "invalid";
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return "invalid";
  return roundMoney(value);
}

function moneyRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const held: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) continue;
    held[key] = roundMoney(amount);
  }
  return held;
}

export function parseBudgetBook(value: unknown): BudgetBook | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as { months?: unknown }).months;
  if (!raw || typeof raw !== "object") return undefined;
  const months: BudgetBook["months"] = {};
  for (const [month, row] of Object.entries(raw)) {
    if (!MONTH_KEY.test(month) || !row || typeof row !== "object") continue;
    const income = (row as { income?: unknown }).income;
    const groups = moneyRecord((row as { groups?: unknown }).groups);
    const categories = moneyRecord((row as { categories?: unknown }).categories);
    const keptIncome = typeof income === "number" && Number.isFinite(income) && income >= 0 ? roundMoney(income) : undefined;
    if (keptIncome == null && Object.keys(groups).length === 0 && Object.keys(categories).length === 0) continue;
    months[month] = {
      ...(keptIncome != null ? { income: keptIncome } : {}),
      groups,
      categories,
    };
  }
  return Object.keys(months).length > 0 ? { months } : undefined;
}

/** A month saved on this device replaces that month. Months only the other copy has are kept. */
export function mergeBudgetBooks(mine?: BudgetBook, theirs?: BudgetBook): BudgetBook | undefined {
  const months = { ...(theirs?.months ?? {}) };
  for (const [month, row] of Object.entries(mine?.months ?? {})) months[month] = row;
  return Object.keys(months).length > 0 ? { months } : undefined;
}

function withMonth(book: BudgetBook, month: string, next: BudgetMonth): BudgetBook {
  const months = { ...book.months };
  const empty = next.income == null && Object.keys(next.groups).length === 0 && Object.keys(next.categories).length === 0;
  if (empty) delete months[month];
  else months[month] = next;
  return { months };
}

export function setIncome(book: BudgetBook, month: string, income: number | null): BudgetBook {
  const current = monthPlan(book, month);
  const next: BudgetMonth = { groups: current.groups, categories: current.categories };
  if (income != null) next.income = income;
  return withMonth(book, month, next);
}

export function setGroupAmount(book: BudgetBook, month: string, groupId: string, amount: number | null): BudgetBook {
  const current = monthPlan(book, month);
  const groups = { ...current.groups };
  if (amount == null) delete groups[groupId];
  else groups[groupId] = amount;
  return withMonth(book, month, { ...current, groups });
}

export function setCategoryAmount(
  book: BudgetBook,
  month: string,
  categoryKey: string,
  amount: number | null,
): BudgetBook {
  const current = monthPlan(book, month);
  const categories = { ...current.categories };
  if (amount == null) delete categories[categoryKey];
  else categories[categoryKey] = amount;
  return withMonth(book, month, { ...current, categories });
}

export function ledgerWithBudgets(ledger: Ledger, book: BudgetBook): Ledger {
  if (Object.keys(book.months).length === 0) {
    const rest = { ...ledger };
    delete rest.budgets;
    return rest;
  }
  return { ...ledger, budgets: book };
}
