/**
 * The category list a person can edit, grouped the way the Redbark PDF is grouped.
 *
 * Groups are folders for the Categories tab and for charts. Filing keys stay the identity
 * of a movement. This book says how those keys are arranged, what they are called, which
 * bank labels hint at them, and which extra keys a person has added.
 */

import {
  applyCategoryOverlay,
  categoryLabel,
  isBuiltinCategoryKey,
  isTransactionType,
  listBuiltinCategories,
  listLooseCategories,
  OTHER,
  RETIRED_CATEGORY_KEYS,
  UNCATEGORISED,
  type TransactionType,
} from "@/lib/money-flow/taxonomy";

export type BookGroup = {
  id: string;
  label: string;
};

export type BookCategory = {
  key: string;
  label: string;
  groupId: string;
  inType: TransactionType;
  outType: TransactionType;
  /** Bank labels that hint at this category, and tags a picker offers. */
  bankCategories: string[];
  builtin: boolean;
};

export type CategoryBook = {
  groups: BookGroup[];
  categories: BookCategory[];
};

const GROUPS: { id: string; label: string; keys: string[] }[] = [
  { id: "income", label: "Income", keys: ["salary", "other-income"] },
  { id: "housing", label: "Housing", keys: ["rent-mortgage", "utilities", "internet-phone", "home-garden"] },
  { id: "food", label: "Food", keys: ["groceries", "eating-out"] },
  { id: "transport", label: "Transport", keys: ["getting-around", "car"] },
  { id: "lifestyle", label: "Lifestyle", keys: ["entertainment", "shopping", "personal-care", "travel"] },
  { id: "health", label: "Health", keys: ["medical", "pets"] },
  { id: "commitments", label: "Commitments", keys: ["insurance", "education-childcare", "debt-payments", "bank-fees", "invest"] },
  { id: "government", label: "Giving & Government", keys: ["donations", "government-tax"] },
  { id: "transfers", label: "Transfers", keys: ["transfers"] },
  { id: "misc", label: "Other", keys: [OTHER, UNCATEGORISED] },
];

let applied: CategoryBook | null = null;

export function defaultCategoryBook(): CategoryBook {
  const builtins = new Map(
    [...listBuiltinCategories(), ...listLooseCategories()].map((category) => [category.key, category]),
  );
  return {
    groups: GROUPS.map(({ id, label }) => ({ id, label })),
    categories: GROUPS.flatMap((group) =>
      group.keys.map((key) => {
        const held = builtins.get(key);
        if (!held) throw new Error(`unknown builtin category ${key}`);
        return {
          key,
          label: held.label,
          groupId: group.id,
          inType: held.inType,
          outType: held.outType,
          bankCategories: uniqueNames(held.tags),
          builtin: true,
        };
      }),
    ),
  };
}

/** A stored book, with any missing built-in keys put back so a later taxonomy cannot orphan them. */
export function resolveBook(stored: CategoryBook | null | undefined): CategoryBook {
  const base = defaultCategoryBook();
  if (!stored || stored.groups.length === 0 || stored.categories.length === 0) return base;

  const kept = stored.categories.filter((category) => !RETIRED_CATEGORY_KEYS.has(category.key));
  const held = new Set(kept.map((category) => category.key));
  const missing = base.categories.filter((category) => !held.has(category.key));
  const groups = stored.groups.map((group) => ({ ...group }));
  const groupIds = new Set(groups.map((group) => group.id));
  for (const category of missing) {
    if (groupIds.has(category.groupId)) continue;
    const fromBase = base.groups.find((group) => group.id === category.groupId);
    if (!fromBase) continue;
    groups.push(fromBase);
    groupIds.add(fromBase.id);
  }

  return {
    groups,
    categories: [
      ...kept.map((category) => ({
        ...category,
        builtin: isBuiltinCategoryKey(category.key),
      })),
      ...missing,
    ],
  };
}

export function parseCategoryBook(value: unknown): CategoryBook | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CategoryBook>;
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.categories)) return null;
  const groups = raw.groups.filter(isGroup);
  const categories = raw.categories.filter(isCategory);
  if (groups.length === 0 || categories.length === 0) return null;
  return resolveBook({ groups, categories });
}

export function applyBook(book: CategoryBook | null): void {
  const next = book ? resolveBook(book) : null;
  applied = next;
  applyCategoryOverlay(
    next
      ? {
          categories: next.categories.map((category) => ({
            key: category.key,
            label: category.label,
            inType: category.inType,
            outType: category.outType,
            bankCategories: category.bankCategories,
          })),
        }
      : null,
  );
}

/** The book currently applied, or the PDF default when none is stored. */
export function resolvedBook(): CategoryBook {
  return applied ?? defaultCategoryBook();
}

export function groupOf(categoryKey: string | undefined): string {
  return resolvedBook().categories.find((category) => category.key === categoryKey)?.groupId ?? "misc";
}

export function groupLabel(groupId: string): string {
  return resolvedBook().groups.find((group) => group.id === groupId)?.label ?? titleCase(groupId);
}

export function isGroupId(value: string): boolean {
  return resolvedBook().groups.some((group) => group.id === value);
}

/** A group or category name for charts, so a rename cannot split a bar. */
export function chartLabel(key: string): string {
  if (isGroupId(key)) return groupLabel(key);
  return categoryLabel(key);
}

function titleCase(value: string): string {
  return value
    .replace(/[.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function addGroup(book: CategoryBook, label: string): CategoryBook {
  const name = tidyName(label);
  if (!name) return book;
  const id = uniqueId(
    slug(name),
    book.groups.map((group) => group.id),
    "group",
  );
  return { ...book, groups: [...book.groups, { id, label: name }] };
}

export function renameGroup(book: CategoryBook, id: string, label: string): CategoryBook {
  const name = tidyName(label);
  if (!name) return book;
  return { ...book, groups: book.groups.map((group) => (group.id === id ? { ...group, label: name } : group)) };
}

export function removeGroup(book: CategoryBook, id: string): CategoryBook {
  const leftover = book.categories.filter((category) => category.groupId === id);
  if (leftover.some((category) => category.builtin)) return book;
  const fallback = book.groups.find((group) => group.id !== id)?.id;
  if (!fallback && leftover.length > 0) return book;
  return {
    groups: book.groups.filter((group) => group.id !== id),
    categories: book.categories.map((category) => (category.groupId === id && fallback ? { ...category, groupId: fallback } : category)),
  };
}

export function addCategory(book: CategoryBook, groupId: string, label: string): CategoryBook {
  if (!book.groups.some((group) => group.id === groupId)) return book;
  const name = tidyName(label);
  if (!name) return book;
  const taken = book.categories.map((category) => category.key);
  const key = uniqueId(slug(name), taken, "category");
  const types = typesForGroup(groupId);
  return {
    ...book,
    categories: [
      ...book.categories,
      { key, label: name, groupId, inType: types.inType, outType: types.outType, bankCategories: [], builtin: false },
    ],
  };
}

export function renameCategory(book: CategoryBook, key: string, label: string): CategoryBook {
  const name = tidyName(label);
  if (!name) return book;
  return {
    ...book,
    categories: book.categories.map((category) => (category.key === key ? { ...category, label: name } : category)),
  };
}

export function removeCategory(book: CategoryBook, key: string): CategoryBook {
  const held = book.categories.find((category) => category.key === key);
  if (!held || held.builtin) return book;
  return { ...book, categories: book.categories.filter((category) => category.key !== key) };
}

export function moveCategory(book: CategoryBook, key: string, groupId: string): CategoryBook {
  if (!book.groups.some((group) => group.id === groupId)) return book;
  return {
    ...book,
    categories: book.categories.map((category) => (category.key === key ? { ...category, groupId } : category)),
  };
}

export function addBankCategory(book: CategoryBook, key: string, name: string): CategoryBook {
  const label = tidyName(name);
  if (!label) return book;
  return {
    ...book,
    categories: book.categories.map((category) => {
      if (category.key !== key) return category;
      if (category.bankCategories.some((held) => held.toLowerCase() === label.toLowerCase())) return category;
      return { ...category, bankCategories: [...category.bankCategories, label] };
    }),
  };
}

export function renameBankCategory(book: CategoryBook, key: string, from: string, to: string): CategoryBook {
  const label = tidyName(to);
  if (!label) return book;
  return {
    ...book,
    categories: book.categories.map((category) => {
      if (category.key !== key) return category;
      return { ...category, bankCategories: uniqueNames(category.bankCategories.map((name) => (name === from ? label : name))) };
    }),
  };
}

export function removeBankCategory(book: CategoryBook, key: string, name: string): CategoryBook {
  return {
    ...book,
    categories: book.categories.map((category) =>
      category.key === key ? { ...category, bankCategories: category.bankCategories.filter((held) => held !== name) } : category,
    ),
  };
}

export function categoriesIn(book: CategoryBook, groupId: string): BookCategory[] {
  return book.categories.filter((category) => category.groupId === groupId);
}

function isGroup(value: unknown): value is BookGroup {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<BookGroup>;
  return typeof raw.id === "string" && raw.id.trim().length > 0 && typeof raw.label === "string" && raw.label.trim().length > 0;
}

function isCategory(value: unknown): value is BookCategory {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<BookCategory>;
  return (
    typeof raw.key === "string" &&
    raw.key.trim().length > 0 &&
    typeof raw.label === "string" &&
    raw.label.trim().length > 0 &&
    typeof raw.groupId === "string" &&
    raw.groupId.trim().length > 0 &&
    isTransactionType(raw.inType) &&
    isTransactionType(raw.outType) &&
    Array.isArray(raw.bankCategories) &&
    raw.bankCategories.every((name) => typeof name === "string")
  );
}

function typesForGroup(groupId: string): { inType: TransactionType; outType: TransactionType } {
  if (groupId === "income") return { inType: "earned", outType: "adjusted" };
  return { inType: "earned", outType: "spent" };
}

function tidyName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

function uniqueId(base: string, taken: string[], fallback: string): string {
  const used = new Set(taken);
  const root = base || fallback;
  if (!used.has(root) && !isBuiltinCategoryKey(root)) return root;
  let n = 2;
  while (used.has(`${root}-${n}`) || isBuiltinCategoryKey(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const held = tidyName(name);
    if (!held) continue;
    const key = held.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(held);
  }
  return result;
}
