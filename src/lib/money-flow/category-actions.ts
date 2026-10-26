/**
 * Moving and archiving a category (CAT-1 Rev 2, Spec 8.6).
 *
 * A move keeps the category key, so past rows and learned rules travel with it.
 * The destination group's typed plan rises when it would sit below the sum of
 * its categories' plans. Archive never deletes the key. One path re-files the
 * rows and points rules at the new category. The other leaves the rows and
 * pauses those rules, so later matches go to Unsorted until it is restored.
 * Only a category a person added can be archived or deleted.
 */

import {
  applyBook,
  bookForLedger,
  categoriesIn,
  FIXED_GROUP_ORDER,
  isFixedGroup,
  moveCategory,
  removeCategory,
  restoreCategory,
  type BookGroup,
  type CategoryBook,
} from "@/lib/money-flow/category-book";
import {
  categoryTotal,
  emptyBudgetBook,
  ledgerWithBudgets,
  monthPlan,
  planMonthOf,
  setCategoryAmount,
  setGroupAmount,
  type BudgetBook,
  type BudgetMonth,
} from "@/lib/money-flow/budget-plan";
import { formatCount, formatAud } from "@/lib/format";
import { ledgerTransactions, recordTaxonomy, replaceTransactions, type Ledger } from "@/lib/money-flow/ledger";
import { roundMoney } from "@/lib/money-flow/parse-values";
import { type Rules } from "@/lib/money-flow/rules";
import { withCategory } from "@/lib/money-flow/tags";

export type ArchiveChoice = { mode: "refile"; targetKey: string } | { mode: "leave" };

export type MovePreview = {
  ok: true;
  categoryLabel: string;
  fromLabel: string;
  toLabel: string;
  toGroupId: string;
  transactionCount: number;
  ruleCount: number;
  /** Blank when this month has no typed amount for the category. */
  planned: number | null;
  /** The destination group's typed amount before the move. Blank stays blank. */
  toAmount: number | null;
  /** The destination group's typed amount after a rise. Null when it does not rise. */
  raisedTo: number | null;
};

const FIXED_REASON = "Fixed groups stay where they are.";
const STARTER_REASON = "Starter categories stay in the list.";

export function categoriesSummary(groups: number, categories: number, archived: number): string {
  const groupWord = groups === 1 ? "group" : "groups";
  const categoryWord = categories === 1 ? "category" : "categories";
  return `${formatCount(groups)} ${groupWord} · ${formatCount(categories)} ${categoryWord} · ${formatCount(archived)} archived`;
}

export function formatPlanDollars(amount: number): string {
  const rounded = roundMoney(amount);
  if (Number.isInteger(rounded)) return `$${rounded.toLocaleString("en-AU")}`;
  return formatAud(rounded);
}

export function transactionCountLabel(count: number, compact = false): string {
  if (compact) return `${formatCount(count)} ${count === 1 ? "txn" : "txns"}`;
  return `${formatCount(count)} ${count === 1 ? "transaction" : "transactions"}`;
}

export function orderedYourGroups(book: CategoryBook): BookGroup[] {
  return book.groups.filter((group) => !isFixedGroup(group.id));
}

export function orderedFixedGroups(book: CategoryBook): BookGroup[] {
  return book.groups
    .filter((group) => isFixedGroup(group.id))
    .sort((a, b) => fixedRank(a.id) - fixedRank(b.id));
}

export function fixedGroupsLine(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return `${labels[0]} is fixed`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} are fixed`;
}

export type MoveGroupChoice = { id: string; label: string; state: "current" | "open" | "fixed" };

export function moveGroupChoices(book: CategoryBook, categoryKey: string): MoveGroupChoice[] {
  const held = book.categories.find((category) => category.key === categoryKey);
  const yours = orderedYourGroups(book).map((group) => ({
    id: group.id,
    label: group.label,
    state: group.id === held?.groupId ? ("current" as const) : ("open" as const),
  }));
  const fixed = orderedFixedGroups(book).map((group) => ({
    id: group.id,
    label: group.label,
    state: "fixed" as const,
  }));
  return [...yours, ...fixed];
}

export type ArchiveTarget = { groupId: string; groupLabel: string; key: string; label: string };

/** Live categories outside the fixed groups, except the one being archived. */
export function archiveTargetCategories(book: CategoryBook, categoryKey: string): ArchiveTarget[] {
  return book.groups.flatMap((group) => {
    if (isFixedGroup(group.id)) return [];
    return categoriesIn(book, group.id)
      .filter((category) => !category.archivedAt && category.key !== categoryKey)
      .map((category) => ({
        groupId: group.id,
        groupLabel: group.label,
        key: category.key,
        label: category.label,
      }));
  });
}

export function defaultArchiveTarget(book: CategoryBook, categoryKey: string): string | null {
  const held = book.categories.find((category) => category.key === categoryKey);
  const targets = archiveTargetCategories(book, categoryKey);
  return targets.find((target) => target.groupId === held?.groupId)?.key ?? targets[0]?.key ?? null;
}

export function previewCategoryMove(input: {
  book: CategoryBook;
  budgets: BudgetBook;
  transactions: readonly { categoryKey: string }[];
  categoryKey: string;
  groupId: string;
  month: string;
  ruleCount: number;
}): { ok: true; preview: MovePreview } | { ok: false; reason: string } {
  const held = input.book.categories.find((category) => category.key === input.categoryKey);
  const destination = input.book.groups.find((group) => group.id === input.groupId);
  if (!held || held.archivedAt) return { ok: false, reason: "That category is not in the list." };
  if (!destination) return { ok: false, reason: "That group is not in the list." };
  if (isFixedGroup(held.groupId) || isFixedGroup(destination.id)) return { ok: false, reason: FIXED_REASON };
  if (held.groupId === destination.id) return { ok: false, reason: "It is already in that group." };
  const from = input.book.groups.find((group) => group.id === held.groupId);
  const plan = monthPlan(input.budgets, input.month);
  const moved = moveCategory(input.book, held.key, destination.id);
  const raisedTo = raisedGroupAmount(moved, plan, destination.id);
  const typed = plan.categories[held.key];
  return {
    ok: true,
    preview: {
      ok: true,
      categoryLabel: held.label,
      fromLabel: from?.label ?? held.groupId,
      toLabel: destination.label,
      toGroupId: destination.id,
      transactionCount: input.transactions.filter((txn) => txn.categoryKey === held.key).length,
      ruleCount: input.ruleCount,
      planned: typed != null && typed > 0 ? typed : null,
      toAmount: plan.groups[destination.id] ?? null,
      raisedTo,
    },
  };
}

export function moveConfirmCopy(
  preview: MovePreview,
  variant: "desktop" | "mobile",
): { title: string; body: string; spending: string; planned: string; confirm: string } {
  const title = `Move \u2018${preview.categoryLabel}\u2019 to ${preview.toLabel}?`;
  const body =
    variant === "desktop"
      ? `${preview.categoryLabel} leaves ${preview.fromLabel}${preview.ruleCount > 0 ? " with its rules" : ""}.`
      : preview.ruleCount > 0
        ? `${preview.categoryLabel} goes with its ${formatCount(preview.ruleCount)} ${preview.ruleCount === 1 ? "rule" : "rules"}.`
        : `${preview.categoryLabel} leaves ${preview.fromLabel}.`;
  const spending = `All past spending moves to ${preview.toLabel} (${transactionCountLabel(preview.transactionCount)}).`;
  let planned = "No planned amount moves with it.";
  if (preview.planned != null && preview.raisedTo != null && preview.toAmount != null) {
    planned = `Planned ${formatPlanDollars(preview.planned)} moves too; ${preview.toLabel} plan rises from ${formatPlanDollars(preview.toAmount)} to ${formatPlanDollars(preview.raisedTo)} to cover its categories.`;
  } else if (preview.planned != null) {
    planned = `Planned ${formatPlanDollars(preview.planned)} moves too.`;
  }
  return { title, body, spending, planned, confirm: `Move to ${preview.toLabel}` };
}

export const ARCHIVE_PLAN_NOTE = "Archived categories drop out of next month\u2019s plan.";
export const ARCHIVE_LEAVE_LABEL = "Leave transactions where they are and archive";
export const ARCHIVE_LEAVE_NOTE = "Its rules will be switched off; new matches go to Unsorted.";

export function archiveIntro(name: string, count: number, variant: "desktop" | "mobile"): string {
  if (count === 0) return `${name} has no transactions, so it can be archived but not deleted.`;
  const noun = count === 1 ? "transaction" : "transactions";
  const base = `${name} has ${formatCount(count)} ${noun}, so it can be archived but not deleted.`;
  if (variant === "mobile") return base;
  return `${base} Choose what happens to ${count === 1 ? "it" : "them"}.`;
}

export function archiveRefileLabel(count: number): string {
  const noun = count === 1 ? "transaction" : "transactions";
  return `Move its ${formatCount(count)} ${noun} to another category, then archive`;
}

export function archiveRulesNote(groupLabel: string, categoryLabel: string): string {
  return `Rules for this category will point to ${groupLabel} \u203a ${categoryLabel}.`;
}

export function ledgerAfterCategoryMove(
  ledger: Ledger,
  categoryKey: string,
  groupId: string,
): { ok: true; ledger: Ledger } | { ok: false; reason: string } {
  const book = bookForLedger(ledger);
  const nextBook = moveCategory(book, categoryKey, groupId);
  if (nextBook === book) {
    const held = book.categories.find((category) => category.key === categoryKey);
    if (held && (isFixedGroup(held.groupId) || isFixedGroup(groupId))) return { ok: false, reason: FIXED_REASON };
    return { ok: false, reason: "That category cannot move there." };
  }
  const budgets = coverGroupPlans(ledger.budgets ?? emptyBudgetBook(), nextBook, groupId);
  applyBook(nextBook);
  return { ok: true, ledger: ledgerWithBudgets(recordTaxonomy(ledger, nextBook), budgets) };
}

/** The category's typed amounts across every month, or nothing when none are set. */
export function plannedTotal(budgets: BudgetBook, categoryKey: string): number | null {
  let total = 0;
  let any = false;
  for (const plan of Object.values(budgets.months)) {
    const amount = plan.categories[categoryKey];
    if (amount == null) continue;
    any = true;
    total += amount;
  }
  if (!any) return null;
  const rounded = roundMoney(total);
  return rounded > 0 ? rounded : null;
}

/** Names the rules and the plan that a delete takes with the category. */
export function deleteConfirmCopy(label: string, ruleCount: number, planned: number | null): string {
  const title = `Delete ${label}?`;
  const parts: string[] = [];
  if (ruleCount > 0) parts.push(`${formatCount(ruleCount)} ${ruleCount === 1 ? "rule" : "rules"}`);
  if (planned != null && planned > 0) parts.push(`${formatPlanDollars(planned)} plan`);
  if (parts.length === 0) return title;
  const verb = parts.length > 1 || ruleCount > 1 ? "go" : "goes";
  return `${title} Its ${parts.join(" and ")} ${verb} too.`;
}

export function ledgerAfterDeleteCategory(
  ledger: Ledger,
  categoryKey: string,
): { ok: true; ledger: Ledger } | { ok: false; reason: string } {
  const book = bookForLedger(ledger);
  const held = book.categories.find((category) => category.key === categoryKey);
  if (!held) return { ok: false, reason: "That category is not in the list." };
  if (held.builtin) return { ok: false, reason: STARTER_REASON };
  if (isFixedGroup(held.groupId)) return { ok: false, reason: FIXED_REASON };
  if (ledgerTransactions(ledger).some((txn) => txn.categoryKey === held.key)) {
    return { ok: false, reason: "That category still has transactions." };
  }
  const nextBook = removeCategory(book, held.key);
  if (nextBook === book) return { ok: false, reason: STARTER_REASON };
  applyBook(nextBook);
  const budgets = clearCategoryPlans(ledger.budgets ?? emptyBudgetBook(), held.key);
  const next = writeRules(
    ledgerWithBudgets(recordTaxonomy(ledger, nextBook), budgets),
    dropRules(ledger.rules ?? {}, held.key),
  );
  return { ok: true, ledger: next };
}

export function ledgerAfterRestore(
  ledger: Ledger,
  categoryKey: string,
): { ok: true; ledger: Ledger } | { ok: false; reason: string } {
  const book = bookForLedger(ledger);
  const nextBook = restoreCategory(book, categoryKey);
  if (nextBook === book) return { ok: false, reason: "That category is not archived." };
  applyBook(nextBook);
  return { ok: true, ledger: recordTaxonomy(ledger, nextBook) };
}

export function ledgerAfterArchive(
  ledger: Ledger,
  categoryKey: string,
  choice: ArchiveChoice,
  now = new Date(),
): { ok: true; ledger: Ledger } | { ok: false; reason: string } {
  const book = bookForLedger(ledger);
  const held = book.categories.find((category) => category.key === categoryKey);
  if (!held || held.archivedAt) return { ok: false, reason: "That category is not in the list." };
  if (held.builtin) return { ok: false, reason: STARTER_REASON };
  if (isFixedGroup(held.groupId)) return { ok: false, reason: FIXED_REASON };
  if (choice.mode === "refile") {
    const target = book.categories.find((category) => category.key === choice.targetKey);
    if (!target || target.archivedAt || target.key === held.key || isFixedGroup(target.groupId)) {
      return { ok: false, reason: "Choose another category." };
    }
  }

  const archivedAt = now.toISOString();
  const nextBook: CategoryBook = {
    ...book,
    categories: book.categories.map((category) => (category.key === held.key ? { ...category, archivedAt } : category)),
  };
  applyBook(nextBook);

  const archiveMonth = planMonthOf(now);
  let next = ledgerWithBudgets(
    recordTaxonomy(ledger, nextBook),
    dropLaterCategoryPlans(ledger.budgets ?? emptyBudgetBook(), held.key, archiveMonth),
  );

  if (choice.mode === "refile") {
    next = writeRules(next, repointRules(ledger.rules ?? {}, held.key, choice.targetKey));
    const stored = ledgerTransactions(ledger);
    if (stored.length > 0) {
      next = replaceTransactions(
        next,
        stored.map((txn) => (txn.categoryKey === held.key ? withCategory(txn, choice.targetKey) : txn)),
      );
    }
  }
  return { ok: true, ledger: next };
}

function clearCategoryPlans(budgets: BudgetBook, categoryKey: string): BudgetBook {
  let next = budgets;
  for (const month of Object.keys(budgets.months)) {
    if (budgets.months[month]?.categories[categoryKey] == null) continue;
    next = setCategoryAmount(next, month, categoryKey, null);
  }
  return next;
}

/** The typed group amount required to cover its categories, or null when no rise is needed. */
export function raisedGroupAmount(book: CategoryBook, plan: BudgetMonth, groupId: string): number | null {
  const typed = plan.groups[groupId];
  if (typed == null) return null;
  const total = categoryTotal(
    categoriesIn(book, groupId)
      .filter((category) => !category.archivedAt)
      .map((category) => plan.categories[category.key] ?? null),
  );
  return typed < total ? total : null;
}

function coverGroupPlans(budgets: BudgetBook, book: CategoryBook, groupId: string): BudgetBook {
  let next = budgets;
  for (const [month, plan] of Object.entries(budgets.months)) {
    const raised = raisedGroupAmount(book, plan, groupId);
    if (raised == null) continue;
    next = setGroupAmount(next, month, groupId, raised);
  }
  return next;
}

function dropLaterCategoryPlans(budgets: BudgetBook, categoryKey: string, archiveMonth: string): BudgetBook {
  let next = budgets;
  for (const month of Object.keys(budgets.months)) {
    if (!archiveMonth || month <= archiveMonth) continue;
    if (budgets.months[month]?.categories[categoryKey] == null) continue;
    next = setCategoryAmount(next, month, categoryKey, null);
  }
  return next;
}

function repointRules(rules: Rules, from: string, to: string): Rules {
  const next: Rules = {};
  for (const [key, rule] of Object.entries(rules)) {
    next[key] = rule.categoryKey === from ? { ...rule, categoryKey: to } : rule;
  }
  return next;
}

function dropRules(rules: Rules, categoryKey: string): Rules {
  const next: Rules = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.categoryKey !== categoryKey) next[key] = rule;
  }
  return next;
}

function writeRules(ledger: Ledger, rules: Rules): Ledger {
  const next = { ...ledger };
  if (Object.keys(rules).length === 0) delete next.rules;
  else next.rules = rules;
  return next;
}

function fixedRank(id: string): number {
  const index = FIXED_GROUP_ORDER.indexOf(id as (typeof FIXED_GROUP_ORDER)[number]);
  return index < 0 ? FIXED_GROUP_ORDER.length : index;
}
