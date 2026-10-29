import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  addBankCategory,
  addCategory,
  addGroup,
  applyBook,
  defaultCategoryBook,
  defaultCategoryForGroup,
  groupLabelOf,
  groupOf,
  parseCategoryBook,
  pickerGroups,
  removeCategory,
  removeGroup,
  renameCategory,
  resolveBook,
  taxonomyPath,
} from "./category-book";
import { matches, tableFilterKeys, tableFilterValue } from "./summary";
import { EMPTY_LEDGER, mergeLedgers, parseLedger, recordTaxonomy } from "./ledger";
import { classify } from "./classify";
import { categoryForBankLabel, categoryLabel, isCategoryKey } from "./taxonomy";
import { withCategory } from "./category-of";
import type { InterpretedTransaction } from "./types";

afterEach(() => {
  applyBook(null);
});

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Shop",
    categoryKey: "uncategorised",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -12,
    type: "spent",
    sourceFile: "statement.csv",
    confidence: 1,
    ...overrides,
  };
}

describe("the editable category book", () => {
  it("starts with the PDF filing keys, grouped the way the PDF is grouped", () => {
    const book = defaultCategoryBook();
    const keys = book.categories.map((category) => category.key);
    assert.ok(keys.includes("salary"));
    assert.ok(keys.includes("groceries"));
    assert.ok(keys.includes("eating-out"));
    assert.ok(keys.includes("invest"));
    assert.ok(keys.includes("transfers"));
    assert.ok(keys.includes("uncategorised"));
    assert.equal(book.categories.find((category) => category.key === "groceries")?.groupId, "food");
    assert.equal(book.categories.find((category) => category.key === "eating-out")?.groupId, "food");
    assert.ok(book.categories.find((category) => category.key === "groceries")?.bankCategories.includes("Groceries"));
    assert.ok(book.categories.find((category) => category.key === "eating-out")?.bankCategories.includes("Fast Food"));
    assert.equal(groupOf("groceries"), "food");
    assert.equal(groupOf("salary"), "income");
    assert.equal(groupLabelOf("groceries"), "Food & Drink");
    assert.equal(groupLabelOf("salary"), "Income");
    assert.equal(taxonomyPath("groceries"), "Food & Drink · Groceries");
    assert.equal(taxonomyPath("salary"), "Income · Salary");
    assert.equal(taxonomyPath("other"), "Unsorted · Other");
    assert.equal(taxonomyPath("transfers"), "Transfers");
    assert.equal(taxonomyPath("uncategorised"), "Unsorted · Not sorted yet");
  });

  it("keeps the current category when the group already holds it", () => {
    assert.equal(defaultCategoryForGroup("housing", "home-garden"), "home-garden");
  });

  it("moves to the first category in a group that does not hold the current one", () => {
    assert.equal(defaultCategoryForGroup("food", "rent-mortgage"), "groceries");
    assert.equal(defaultCategoryForGroup("unsorted", "groceries"), "other");
  });

  it("lists picker options under the PDF groups, with Not sorted yet only when asked", () => {
    const groups = pickerGroups();
    assert.equal(groups[0]?.label, "Income");
    assert.deepEqual(
      groups.find((group) => group.id === "food")?.categories.map((category) => category.key),
      ["groceries", "eating-out"],
    );
    assert.ok(!pickerGroups().some((group) => group.categories.some((category) => category.key === "uncategorised")));
    assert.ok(
      pickerGroups({ includeUncategorised: true }).some((group) =>
        group.categories.some((category) => category.key === "uncategorised"),
      ),
    );
  });

  it("keeps a Food chart selection in the table filter and matches a Groceries row", () => {
    const rows = [txn({ merchant: "Woolworths", categoryKey: "groceries" })];
    const options = ["All", ...tableFilterKeys(rows)];
    assert.ok(options.includes("food"));
    assert.ok(options.includes("groceries"));
    assert.equal(tableFilterValue("food", options), "food");
    assert.equal(matches(rows[0], "food"), true);
    assert.equal(matches(rows[0], "groceries"), true);
    assert.equal(matches(rows[0], "housing"), false);
  });

  it("adds and removes an empty group a person added, and refuses any other", () => {
    const named = addGroup(defaultCategoryBook(), "Side hustle");
    const id = named.groups.find((group) => group.label === "Side hustle")?.id ?? "";
    assert.ok(named.groups.some((group) => group.label === "Side hustle"));
    const withOne = addCategory(named, id, "Etsy");
    const blocked = removeGroup(withOne, id);
    assert.equal(blocked, withOne);
    assert.equal(blocked.categories.find((category) => category.label === "Etsy")?.groupId, id);
    const archived = {
      ...withOne,
      categories: withOne.categories.map((category) =>
        category.label === "Etsy" ? { ...category, archivedAt: "2026-10-01T00:00:00.000Z" } : category,
      ),
    };
    assert.equal(removeGroup(archived, id), archived);
    const emptied = removeGroup(named, id);
    assert.ok(!emptied.groups.some((group) => group.label === "Side hustle"));
    const starter = defaultCategoryBook();
    assert.equal(removeGroup(starter, "food"), starter);
    assert.equal(removeGroup(starter, "income"), starter);
    assert.equal(removeGroup(starter, "money-moves"), starter);
    assert.equal(removeGroup(starter, "transfers"), starter);
    assert.equal(removeGroup(starter, "unsorted"), starter);
  });

  it("lets a person add a category and refuses to delete a built-in one", () => {
    const book = addCategory(defaultCategoryBook(), "health", "Physio");
    const added = book.categories.find((category) => category.label === "Physio");
    assert.ok(added);
    assert.equal(added?.builtin, false);
    assert.equal(removeCategory(book, "medical").categories.some((category) => category.key === "medical"), true);
    assert.ok(!removeCategory(book, added?.key ?? "").categories.some((category) => category.label === "Physio"));
  });

  it("renames a category without changing its key", () => {
    const book = renameCategory(defaultCategoryBook(), "eating-out", "Dining");
    assert.equal(book.categories.find((category) => category.key === "eating-out")?.label, "Dining");
  });

  it("puts a missing built-in key back when an older book is read, and drops retired keys", () => {
    const stored = {
      groups: [{ id: "food", label: "Food" }],
      categories: [
        {
          key: "food",
          label: "Food & Drink",
          groupId: "food",
          inType: "earned" as const,
          outType: "spent" as const,
          bankCategories: ["Groceries"],
          builtin: true,
        },
      ],
    };
    const resolved = resolveBook(stored);
    assert.ok(!resolved.categories.some((category) => category.key === "food"));
    assert.ok(resolved.categories.some((category) => category.key === "groceries"));
    assert.ok(resolved.categories.some((category) => category.key === "rent-mortgage"));
    assert.ok(resolved.groups.some((group) => group.id === "housing"));
  });

  it("rejects junk and keeps a well-formed book", () => {
    assert.equal(parseCategoryBook(null), null);
    assert.equal(parseCategoryBook({ groups: [], categories: [] }), null);
    const parsed = parseCategoryBook(defaultCategoryBook());
    assert.ok(parsed);
    assert.ok(parsed.categories.some((category) => category.key === "salary"));
  });
});

describe("applying the book to the taxonomy", () => {
  it("makes a custom key real, and a rename the name a person reads", () => {
    const book = renameCategory(addCategory(defaultCategoryBook(), "health", "Physio"), "eating-out", "Dining");
    applyBook(book);
    const extra = book.categories.find((category) => category.label === "Physio");
    assert.ok(extra);
    assert.equal(isCategoryKey(extra.key), true);
    assert.equal(withCategory(txn(), extra.key).categoryKey, extra.key);
    assert.equal(categoryLabel("eating-out"), "Dining");
    applyBook(null);
    assert.equal(isCategoryKey(extra.key), false);
    assert.equal(categoryLabel("eating-out"), "Eating Out");
    assert.equal(withCategory(txn(), extra.key).categoryKey, "uncategorised");
  });

  it("maps a bank label the person added onto an unsorted movement", () => {
    const book = addBankCategory(defaultCategoryBook(), "clothing", "Corner Shop");
    applyBook(book);
    assert.equal(categoryForBankLabel("Corner Shop"), "clothing.corner-shop");
    const [placed] = classify([
      txn({
        bank: { category: "Corner Shop" },
        decidedBy: "unreviewed",
      }),
    ]);
    assert.equal(placed.categoryKey, "clothing");
    assert.equal(placed.decidedBy, "bank");
  });
});

describe("keeping the book beside the ledger", () => {
  it("round-trips through storage and survives a merge from an empty copy", () => {
    const book = addCategory(defaultCategoryBook(), "health", "Physio");
    const held = recordTaxonomy(EMPTY_LEDGER, book);
    const restored = parseLedger(JSON.parse(JSON.stringify(held)));
    assert.ok(restored?.taxonomy?.categories.some((category) => category.label === "Physio"));
    assert.ok(mergeLedgers(EMPTY_LEDGER, held).taxonomy);
    assert.ok(mergeLedgers(held, EMPTY_LEDGER).taxonomy);
  });
});
