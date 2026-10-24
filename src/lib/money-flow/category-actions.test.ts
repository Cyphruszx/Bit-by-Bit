import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  addCategory,
  addGroup,
  applyBook,
  bookForLedger,
  defaultCategoryBook,
  moveCategory,
  renameCategory,
  renameGroup,
} from "./category-book";
import {
  ARCHIVE_LEAVE_NOTE,
  ARCHIVE_PLAN_NOTE,
  archiveIntro,
  archiveRefileLabel,
  archiveRulesNote,
  categoriesSummary,
  fixedGroupsLine,
  deleteConfirmCopy,
  ledgerAfterArchive,
  ledgerAfterCategoryMove,
  ledgerAfterDeleteCategory,
  ledgerAfterRestore,
  moveConfirmCopy,
  orderedFixedGroups,
  previewCategoryMove,
  raisedGroupAmount,
} from "./category-actions";
import { budgetGroupLines, emptyBudgetBook, ledgerWithBudgets, planMonthOf, setCategoryAmount, setGroupAmount } from "./budget-plan";
import { classify } from "./classify";
import { interpretMovement } from "./interpret-row";
import { appendToLedger, EMPTY_LEDGER, ledgerTransactions, parseLedger, persistTaxonomy, recordTaxonomy, type Ledger } from "./ledger";
import { learn } from "./rules";
import { isCategoryKey } from "./taxonomy";
import type { FileInterpretation, InterpretedTransaction } from "./types";

afterEach(() => {
  applyBook(null);
});

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Local Cafe",
    categoryKey: "uncategorised",
    decidedBy: "unreviewed",
    date: "6 Oct",
    dateIso: "2026-10-06",
    amount: -4,
    type: "spent",
    sourceFile: "demo.csv",
    confidence: 1,
    ...overrides,
  };
}

function file(): FileInterpretation {
  return {
    filename: "demo.csv",
    fileType: "csv",
    kind: "csv",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    transactionCount: 0,
    notes: [],
  };
}

function coffeeBook() {
  const book = addCategory(defaultCategoryBook(), "food", "Coffee");
  applyBook(book);
  const key = book.categories.find((category) => category.label === "Coffee")?.key;
  assert.ok(key);
  return { book, key };
}

function withRows(rows: InterpretedTransaction[]): Ledger {
  const { book } = coffeeBook();
  const ledger = appendToLedger(EMPTY_LEDGER, { files: [file()], transactions: rows }, {
    importedAt: "2026-10-23T01:00:00.000Z",
  }).ledger;
  return recordTaxonomy({ ...ledger, starterListVersion: 2 }, book);
}

describe("moving a category", () => {
  it("carries the planned amount and raises the destination group plan", () => {
    const { key } = coffeeBook();
    const rows = Array.from({ length: 18 }, (_, index) =>
      txn({ id: `c${index}`, categoryKey: key, merchant: "Local Cafe", amount: -4 }),
    );
    let ledger = withRows(rows);
    ledger = {
      ...ledger,
      rules: learn({}, txn({ categoryKey: "eating-out" }), key, "2026-10-01T00:00:00.000Z"),
    };
    let budgets = setGroupAmount(emptyBudgetBook(), "2026-10", "lifestyle", 300);
    budgets = setGroupAmount(budgets, "2026-10", "food", 200);
    budgets = setCategoryAmount(budgets, "2026-10", "entertainment", 300);
    budgets = setCategoryAmount(budgets, "2026-10", key, 60);
    ledger = ledgerWithBudgets(ledger, budgets);

    const preview = previewCategoryMove({
      book: bookForLedger(ledger),
      budgets,
      transactions: ledgerTransactions(ledger),
      categoryKey: key,
      groupId: "lifestyle",
      month: "2026-10",
      ruleCount: 1,
    });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    const copy = moveConfirmCopy(preview.preview, "desktop");
    assert.equal(copy.title, "Move \u2018Coffee\u2019 to Lifestyle?");
    assert.equal(copy.body, "Coffee leaves Food & Drink with its rules.");
    assert.equal(copy.spending, "All past spending moves to Lifestyle (18 transactions).");
    assert.equal(
      copy.planned,
      "Planned $60 moves too; Lifestyle plan rises from $300 to $360 to cover its categories.",
    );
    assert.equal(moveConfirmCopy(preview.preview, "mobile").body, "Coffee goes with its 1 rule.");
    assert.doesNotMatch(copy.body, /subcategor/i);
    assert.doesNotMatch(copy.planned, /subcategor/i);

    const moved = ledgerAfterCategoryMove(ledger, key, "lifestyle");
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    const book = bookForLedger(moved.ledger);
    assert.equal(book.categories.find((category) => category.key === key)?.groupId, "lifestyle");
    assert.equal(moved.ledger.budgets?.months["2026-10"]?.categories[key], 60);
    assert.equal(moved.ledger.budgets?.months["2026-10"]?.groups.lifestyle, 360);
    assert.equal(moved.ledger.budgets?.months["2026-10"]?.groups.food, 200);
    assert.equal(moved.ledger.rules?.[Object.keys(moved.ledger.rules)[0] ?? ""]?.categoryKey, key);
    for (const row of ledgerTransactions(moved.ledger)) {
      if (row.id.startsWith("c")) assert.equal(row.categoryKey, key);
    }
  });

  it("leaves a group plan that already covers the arriving amount", () => {
    const book = addCategory(defaultCategoryBook(), "food", "Coffee");
    const key = book.categories.find((category) => category.label === "Coffee")?.key ?? "";
    const plan = {
      groups: { lifestyle: 500 },
      categories: { entertainment: 100, [key]: 60 },
    };
    const moved = moveCategory(book, key, "lifestyle");
    assert.equal(raisedGroupAmount(moved, plan, "lifestyle"), null);
  });

  it("does not invent a group plan when the destination was blank", () => {
    const book = addCategory(defaultCategoryBook(), "food", "Coffee");
    const key = book.categories.find((category) => category.label === "Coffee")?.key ?? "";
    const plan = { groups: {}, categories: { [key]: 60 } };
    assert.equal(raisedGroupAmount(moveCategory(book, key, "lifestyle"), plan, "lifestyle"), null);
  });

  it("blocks moves into and out of fixed groups", () => {
    const book = addCategory(defaultCategoryBook(), "food", "Coffee");
    const key = book.categories.find((category) => category.label === "Coffee")?.key ?? "";
    assert.equal(moveCategory(book, key, "income"), book);
    assert.equal(moveCategory(book, key, "money-moves"), book);
    assert.equal(moveCategory(book, key, "transfers"), book);
    assert.equal(moveCategory(book, key, "unsorted"), book);
    assert.equal(moveCategory(book, "salary", "lifestyle"), book);
    const shifted = moveCategory(book, "groceries", "lifestyle");
    assert.equal(shifted.categories.find((category) => category.key === "groceries")?.groupId, "lifestyle");
    assert.equal(shifted.categories.find((category) => category.key === "groceries")?.builtin, true);
    assert.equal(addCategory(book, "income", "Bonus"), book);
    assert.equal(renameGroup(book, "unsorted", "Loose"), book);
    assert.equal(renameCategory(book, "salary", "Wages"), book);
    const ledger = recordTaxonomy(EMPTY_LEDGER, book);
    assert.equal(ledgerAfterCategoryMove(ledger, key, "transfers").ok, false);
    assert.equal(ledgerAfterCategoryMove(ledger, "salary", "food").ok, false);
    assert.deepEqual(
      orderedFixedGroups(book).map((group) => group.label),
      ["Income", "Money moves", "Transfers", "Unsorted"],
    );
    assert.equal(fixedGroupsLine(["Income", "Money moves", "Transfers", "Unsorted"]), "Income, Money moves, Transfers and Unsorted are fixed");
  });

  it("puts a new group with the editable groups, ahead of the trailing fixed ones", () => {
    const book = addGroup(defaultCategoryBook(), "Side hustle");
    const labels = book.groups.map((group) => group.label);
    assert.ok(labels.indexOf("Side hustle") < labels.indexOf("Money moves"));
    assert.ok(labels.indexOf("Side hustle") > labels.indexOf("Admin & Fees"));
  });
});

describe("archiving a category", () => {
  const now = new Date("2026-10-23T01:00:00.000Z");

  function prepared() {
    const { key } = coffeeBook();
    const rows = [txn({ id: "a", categoryKey: key, amount: -12 }), txn({ id: "b", categoryKey: key, amount: -6 })];
    let ledger = withRows(rows);
    ledger = {
      ...ledger,
      rules: learn({}, txn({ id: "a", categoryKey: "eating-out" }), key, "2026-10-01T00:00:00.000Z"),
    };
    let budgets = setCategoryAmount(emptyBudgetBook(), "2026-10", key, 60);
    budgets = setCategoryAmount(budgets, "2026-11", key, 60);
    ledger = ledgerWithBudgets(ledger, budgets);
    return { ledger, key };
  }

  it("re-files transactions and points rules at the other category", () => {
    const { ledger, key } = prepared();
    const result = ledgerAfterArchive(ledger, key, { mode: "refile", targetKey: "eating-out" }, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const book = bookForLedger(result.ledger);
    const archived = book.categories.find((category) => category.key === key);
    assert.equal(archived?.archivedAt, now.toISOString());
    assert.equal(archived?.label, "Coffee");
    for (const row of ledgerTransactions(result.ledger)) assert.equal(row.categoryKey, "eating-out");
    const rule = Object.values(result.ledger.rules ?? {})[0];
    assert.equal(rule?.categoryKey, "eating-out");
    assert.equal(result.ledger.budgets?.months["2026-10"]?.categories[key], 60);
    assert.equal(result.ledger.budgets?.months["2026-11"]?.categories[key], undefined);
    applyBook(book);
    const october = budgetGroupLines(book, result.ledger.budgets?.months["2026-10"] ?? { groups: {}, categories: {} }, new Map(), "2026-10");
    const november = budgetGroupLines(book, result.ledger.budgets?.months["2026-11"] ?? { groups: {}, categories: {} }, new Map(), "2026-11");
    assert.ok(october.find((line) => line.id === "food")?.categories.some((category) => category.key === key));
    assert.equal(november.find((line) => line.id === "food")?.categories.some((category) => category.key === key), false);
    const restored = parseLedger(JSON.parse(JSON.stringify(result.ledger)));
    assert.equal(restored?.taxonomy?.categories.find((category) => category.key === key)?.archivedAt, now.toISOString());
    assert.equal(archiveRulesNote("Food & Drink", "Eating Out"), "Rules for this category will point to Food & Drink \u203a Eating Out.");
    assert.equal(archiveRefileLabel(2), "Move its 2 transactions to another category, then archive");
  });

  it("leaves transactions, pauses rules, and sends new matches to Unsorted", () => {
    const { ledger, key } = prepared();
    const kept = ledgerTransactions(ledger).map((row) => row.categoryKey);
    const result = ledgerAfterArchive(ledger, key, { mode: "leave" }, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const paused = Object.values(result.ledger.rules ?? {})[0];
    assert.equal(paused?.categoryKey, key);
    assert.deepEqual(ledgerTransactions(result.ledger).map((row) => row.categoryKey), kept);
    applyBook(bookForLedger(result.ledger));
    const fresh = txn({ id: "new", categoryKey: "uncategorised", decidedBy: "unreviewed" });
    const [placed] = classify([fresh], { rules: result.ledger.rules ?? {} });
    assert.equal(placed?.categoryKey, "uncategorised");
    const remembered = txn({
      id: "old",
      categoryKey: key,
      decidedBy: "user_overridden",
      merchant: "Local Cafe",
    });
    const [again] = classify([remembered, fresh]);
    assert.equal(again?.categoryKey, key);
    assert.equal(classify([remembered, fresh])[1]?.categoryKey, "uncategorised");

    const groceries = ledgerAfterArchive(recordTaxonomy(EMPTY_LEDGER, defaultCategoryBook()), "groceries", { mode: "leave" }, now);
    assert.equal(groceries.ok, false);
    const alreadyArchived = {
      ...defaultCategoryBook(),
      categories: defaultCategoryBook().categories.map((category) =>
        category.key === "groceries" ? { ...category, archivedAt: now.toISOString() } : category,
      ),
    };
    applyBook(alreadyArchived);
    const woolworths = interpretMovement({
      dateIso: "2026-10-06",
      amount: -20,
      directionKnown: true,
      description: "WOOLWORTHS 1234",
      sourceFile: "demo.csv",
      id: "w",
      confidence: 1,
    });
    assert.equal(woolworths.categoryKey, "uncategorised");
    assert.equal(woolworths.decidedBy, "unreviewed");
    assert.equal(archiveIntro("Coffee", 18, "desktop"), "Coffee has 18 transactions, so it can be archived but not deleted. Choose what happens to them.");
    assert.equal(archiveIntro("Coffee", 18, "mobile"), "Coffee has 18 transactions, so it can be archived but not deleted.");
    assert.equal(ARCHIVE_LEAVE_NOTE, "Its rules will be switched off; new matches go to Unsorted.");
    assert.equal(ARCHIVE_PLAN_NOTE, "Archived categories drop out of next month\u2019s plan.");
    assert.doesNotMatch(ARCHIVE_PLAN_NOTE, /Bring one back/);
    assert.equal(planMonthOf(now), "2026-10");
  });

  it("refuses to archive a category in a fixed group or to re-file into one", () => {
    const ledger = recordTaxonomy(EMPTY_LEDGER, defaultCategoryBook());
    assert.equal(ledgerAfterArchive(ledger, "salary", { mode: "leave" }, now).ok, false);
    const { ledger: custom, key } = prepared();
    assert.equal(ledgerAfterArchive(custom, key, { mode: "refile", targetKey: "salary" }, now).ok, false);
    assert.equal(bookForLedger(custom).categories.find((category) => category.key === key)?.archivedAt, undefined);
  });
});

describe("deleting a category", () => {
  it("refuses when any month still has a transaction, and when the category is a starter", () => {
    const { key } = coffeeBook();
    const ledger = withRows([
      txn({ id: "jan", categoryKey: key, dateIso: "2026-01-15", date: "15 Jan", amount: -8 }),
    ]);
    const blocked = ledgerAfterDeleteCategory(ledger, key);
    assert.equal(blocked.ok, false);
    assert.ok(bookForLedger(ledger).categories.some((category) => category.key === key));
    const starter = recordTaxonomy(EMPTY_LEDGER, defaultCategoryBook());
    assert.equal(ledgerAfterDeleteCategory(starter, "groceries").ok, false);
    assert.equal(ledgerAfterDeleteCategory(starter, "salary").ok, false);
    assert.equal(ledgerAfterArchive(starter, "groceries", { mode: "leave" }).ok, false);
    assert.equal(ledgerAfterArchive(starter, "salary", { mode: "leave" }).ok, false);
  });

  it("removes the category, its rules, and its plan in every month", () => {
    const { key } = coffeeBook();
    let ledger = withRows([]);
    ledger = {
      ...ledger,
      rules: learn({}, txn({ categoryKey: "eating-out" }), key, "2026-10-01T00:00:00.000Z"),
    };
    let budgets = setCategoryAmount(emptyBudgetBook(), "2026-01", key, 50);
    budgets = setCategoryAmount(budgets, "2026-11", key, 20);
    ledger = ledgerWithBudgets(ledger, budgets);
    assert.equal(deleteConfirmCopy("Gym", 1, 50), "Delete Gym? Its 1 rule and $50 plan go too.");
    assert.equal(deleteConfirmCopy("Gym", 2, null), "Delete Gym? Its 2 rules go too.");
    assert.equal(deleteConfirmCopy("Gym", 0, 50), "Delete Gym? Its $50 plan goes too.");
    assert.equal(deleteConfirmCopy("Gym", 0, null), "Delete Gym?");
    const result = ledgerAfterDeleteCategory(ledger, key);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(bookForLedger(result.ledger).categories.some((category) => category.key === key), false);
    assert.equal(result.ledger.rules, undefined);
    assert.equal(result.ledger.budgets?.months["2026-01"]?.categories[key], undefined);
    assert.equal(result.ledger.budgets?.months["2026-11"]?.categories[key], undefined);
  });
});

describe("restoring a category", () => {
  const now = new Date("2026-10-23T01:00:00.000Z");

  it("clears the archive, turns paused rules back on, and leaves past rows", () => {
    const { key } = coffeeBook();
    const rows = [txn({ id: "a", categoryKey: key, amount: -12 })];
    let ledger = withRows(rows);
    ledger = {
      ...ledger,
      rules: learn({}, txn({ id: "a", categoryKey: "eating-out" }), key, "2026-10-01T00:00:00.000Z"),
    };
    const archived = ledgerAfterArchive(ledger, key, { mode: "leave" }, now);
    assert.equal(archived.ok, true);
    if (!archived.ok) return;
    const before = ledgerTransactions(archived.ledger).map((row) => row.categoryKey);
    applyBook(bookForLedger(archived.ledger));
    const fresh = txn({ id: "new", merchant: "Local Cafe", categoryKey: "uncategorised", decidedBy: "unreviewed" });
    assert.equal(classify([fresh], { rules: archived.ledger.rules ?? {} })[0]?.categoryKey, "uncategorised");

    const restored = ledgerAfterRestore(archived.ledger, key);
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    const back = bookForLedger(restored.ledger).categories.find((category) => category.key === key);
    assert.equal(back?.archivedAt, undefined);
    assert.equal(back?.groupId, "food");
    assert.deepEqual(
      ledgerTransactions(restored.ledger).map((row) => row.categoryKey),
      before,
    );
    applyBook(bookForLedger(restored.ledger));
    assert.equal(classify([fresh], { rules: restored.ledger.rules ?? {} })[0]?.categoryKey, key);

    const parked = recordTaxonomy(archived.ledger, {
      ...bookForLedger(archived.ledger),
      categories: bookForLedger(archived.ledger).categories.map((category) =>
        category.key === key ? { ...category, groupId: "retired-group" } : category,
      ),
    });
    const moved = ledgerAfterRestore(parked, key);
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    assert.equal(bookForLedger(moved.ledger).categories.find((category) => category.key === key)?.groupId, "housing");
  });
});

describe("loading a custom category", () => {
  it("keeps its key when the book is applied before stored rows are rewritten", () => {
    applyBook(defaultCategoryBook());
    const { key } = coffeeBook();
    const ledger = withRows([txn({ id: "c0", categoryKey: key, merchant: "Local Cafe", amount: -4 })]);
    applyBook(defaultCategoryBook());
    assert.equal(isCategoryKey(key), false);
    applyBook(bookForLedger(ledger));
    const next = persistTaxonomy(ledger);
    assert.equal(next, ledger);
    assert.equal(ledger.entries.find((entry) => entry.id === "c0")?.categoryKey, key);
  });
});

describe("categories summary", () => {
  it("counts groups, live categories, and archived categories", () => {
    assert.equal(categoriesSummary(14, 31, 3), "14 groups · 31 categories · 3 archived");
    assert.equal(categoriesSummary(1, 1, 0), "1 group · 1 category · 0 archived");
  });
});
