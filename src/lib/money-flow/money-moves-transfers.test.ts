import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  applyBook,
  defaultCategoryBook,
  parseCategoryBook,
  resolveBook,
  withTransfersGroup,
  type CategoryBook,
} from "@/lib/money-flow/category-book";
import { budgetGroupLines, planTotals, spentByCategoryKey, unsortedSpent } from "@/lib/money-flow/budget-plan";
import { selectableGroups, summarizeMoneyFlow } from "@/lib/money-flow/summary";
import { STARTER_LIST_VERSION } from "@/lib/money-flow/starter-list";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

afterEach(() => applyBook(null));

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount">,
): InterpretedTransaction {
  return {
    merchant: "Shop",
    categoryKey: "groceries",
    date: "2026-10-06",
    dateIso: "2026-10-06",
    type: over.amount > 0 ? "earned" : "spent",
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

/** A book saved before the split: transfers filed inside Money moves, no Transfers group. */
function oldSavedBook(): CategoryBook {
  const book = defaultCategoryBook();
  return {
    ...book,
    groups: book.groups.filter((group) => group.id !== "transfers"),
    categories: book.categories.map((category) =>
      category.key === "transfers" ? { ...category, groupId: "money-moves" } : category,
    ),
  };
}

describe("Transfers group split", () => {
  it("starter list has Transfers on its own, just before Unsorted", () => {
    const book = defaultCategoryBook();
    const ids = book.groups.map((group) => group.id);
    assert.deepEqual(ids.slice(-3), ["money-moves", "transfers", "unsorted"]);
    const moves = book.categories.filter((c) => c.groupId === "money-moves").map((c) => c.key);
    assert.deepEqual(moves, ["invest", "debt-payments"]);
  });

  it("migrates a saved book once, and rerunning changes nothing", () => {
    const saved = oldSavedBook();
    const once = withTransfersGroup(saved);
    assert.equal(once.categories.find((c) => c.key === "transfers")?.groupId, "transfers");
    assert.deepEqual(once.groups.map((g) => g.id).slice(-2), ["transfers", "unsorted"]);
    assert.deepEqual(withTransfersGroup(once), once);
    const parsed = parseCategoryBook(JSON.parse(JSON.stringify({ ...saved, starterListVersion: STARTER_LIST_VERSION })));
    assert.ok(parsed);
    assert.equal(parsed.categories.find((c) => c.key === "transfers")?.groupId, "transfers");
    assert.equal(parsed.groups.filter((g) => g.id === "transfers").length, 1);
    assert.deepEqual(resolveBook(parsed), parsed);
    // keys and labels unchanged
    assert.deepEqual(
      parsed.categories.map((c) => c.key).sort(),
      saved.categories.map((c) => c.key).sort(),
    );
  });

  it("leaves a person's own move of transfers elsewhere alone", () => {
    const saved = oldSavedBook();
    const moved = { ...saved, categories: saved.categories.map((c) => (c.key === "transfers" ? { ...c, groupId: "bills" } : c)) };
    assert.deepEqual(withTransfersGroup(moved), moved);
  });

  it("puts Transfers then Unsorted last in the chip row", () => {
    const rows = [
      txn({ id: "u", amount: -5, categoryKey: "uncategorised" }),
      txn({ id: "t", amount: -5, categoryKey: "transfers", type: "moved" }),
      txn({ id: "f", amount: -5, categoryKey: "groceries" }),
      txn({ id: "i", amount: -5, categoryKey: "invest", type: "invested" }),
    ];
    assert.deepEqual(selectableGroups(rows), ["food", "money-moves", "transfers", "unsorted"]);
  });
});

describe("Budget Spent equals Money out minus Unsorted", () => {
  const month = [
    txn({ id: "pay", amount: 4000, categoryKey: "salary" }),
    txn({ id: "groc", amount: -120.5, categoryKey: "groceries" }),
    txn({ id: "rent", amount: -1800, categoryKey: "rent-mortgage" }),
    txn({ id: "inv", amount: -500, categoryKey: "invest", type: "invested" }),
    txn({ id: "debt", amount: -250, categoryKey: "debt-payments", type: "repaid" }),
    txn({ id: "xfer", amount: -300, categoryKey: "transfers", type: "TRANSFER" }),
    txn({ id: "loose", amount: -42.25, categoryKey: "uncategorised" }),
    txn({ id: "refund", amount: 20, categoryKey: "groceries", type: "REFUND" }),
  ];

  it("matches for a month of fixture rows", () => {
    const book = defaultCategoryBook();
    applyBook(book);
    const spentMap = spentByCategoryKey(month);
    const spent = planTotals(budgetGroupLines(book, { groups: {}, categories: {} }, spentMap)).spent;
    const loose = unsortedSpent(book, spentMap);
    const { cashOut } = summarizeMoneyFlow(month);
    // Investing and Debt Payments count; Transfers does not.
    assert.equal(cashOut, 120.5 + 1800 + 500 + 250 + 42.25);
    assert.equal(spent, Math.round((cashOut - loose) * 100) / 100);
    assert.equal(loose, 42.25);
  });

  it("treats refunds the same on both sides: neither subtracts a refund credit", () => {
    const book = defaultCategoryBook();
    applyBook(book);
    const withRefund = summarizeMoneyFlow(month).cashOut;
    const without = summarizeMoneyFlow(month.filter((t) => t.id !== "refund")).cashOut;
    assert.equal(withRefund, without);
    const a = planTotals(budgetGroupLines(book, { groups: {}, categories: {} }, spentByCategoryKey(month))).spent;
    const b = planTotals(
      budgetGroupLines(book, { groups: {}, categories: {} }, spentByCategoryKey(month.filter((t) => t.id !== "refund"))),
    ).spent;
    assert.equal(a, b);
  });
});
