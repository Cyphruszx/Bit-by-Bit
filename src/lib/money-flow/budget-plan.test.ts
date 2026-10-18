import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { formatAud } from "@/lib/format";
import { EMPTY_LEDGER, mergeLedgers, parseLedger } from "@/lib/money-flow/ledger";
import { applyBook, defaultCategoryBook } from "@/lib/money-flow/category-book";
import {
  budgetGroupLines,
  countedGroupAmount,
  emptyBudgetBook,
  groupShortfall,
  leftToPlan,
  leftToSpend,
  monthPlan,
  planTotals,
  ringRead,
  setCategoryAmount,
  setGroupAmount,
  setIncome,
  spentByCategoryKey,
  unsortedSpent,
} from "@/lib/money-flow/budget-plan";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

afterEach(() => {
  applyBook(null);
});

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount">,
): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: "2026-10-06",
    dateIso: "2026-10-06",
    type: over.amount > 0 ? "earned" : "spent",
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

describe("BV.A.2c group counting", () => {
  it("(a) income $3,000 with Eating Out $300 containing Coffee $60 leaves $2,700 to plan", () => {
    const counted = countedGroupAmount(300, [60]);
    const plan = leftToPlan(3000, counted);
    assert.equal(counted, 300);
    assert.equal(plan.status, "left");
    if (plan.status !== "left") return;
    assert.equal(plan.amount, 2700);
    assert.equal(formatAud(plan.amount), "$2,700.00");
    assert.notEqual(plan.amount, 2640);
    assert.equal(plan.status === "left", true);
  });

  it("(b) Eating Out $50 containing Coffee $60 counts the group as $60", () => {
    assert.equal(countedGroupAmount(50, [60]), 60);
    assert.equal(groupShortfall(50, [60]), 60);
    const plan = leftToPlan(3000, countedGroupAmount(50, [60]));
    assert.equal(plan.status, "left");
    if (plan.status !== "left") return;
    assert.equal(plan.amount, 2940);
  });

  it("counts a blank group as its category total and never stacks the two", () => {
    assert.equal(countedGroupAmount(null, [60, 40]), 100);
    assert.equal(groupShortfall(null, [60]), null);
    assert.equal(countedGroupAmount(300, [60, 40]), 300);
  });
});

describe("BV.A.2c ring and left to spend", () => {
  it("fills to spent / planned and reads over when the ring is full", () => {
    assert.deepEqual(ringRead(100, 25), { fill: 0.25, empty: false, over: false, figure: 75 });
    assert.deepEqual(ringRead(50, 80), { fill: 1, empty: false, over: true, figure: 30 });
    assert.deepEqual(ringRead(0, 12), { fill: 1, empty: false, over: true, figure: 12 });
    assert.deepEqual(ringRead(0, 0), { fill: 0, empty: true, over: false, figure: 0 });
  });

  it("reads left to spend as planned minus spent", () => {
    assert.deepEqual(leftToSpend(4770, 4409), { amount: 361, over: false, planned: 4770, spent: 4409 });
    const over = leftToSpend(50, 80);
    assert.equal(over.over, true);
    assert.equal(over.amount, 30);
  });

  it("hides a calculated left to plan when expected income is not set", () => {
    assert.equal(leftToPlan(null, 300).status, "unset");
    const over = leftToPlan(4000, 4200);
    assert.equal(over.status, "over");
    if (over.status !== "over") return;
    assert.equal(over.amount, 200);
  });
});

describe("budget book storage", () => {
  it("round-trips a month and lets this device's month replace the other copy", () => {
    let book = setIncome(emptyBudgetBook(), "2026-10", 3000);
    book = setGroupAmount(book, "2026-10", "eating-out", 300);
    book = setCategoryAmount(book, "2026-10", "coffee", 60);
    const ledger = { ...EMPTY_LEDGER, budgets: book };
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));
    assert.equal(restored?.budgets?.months["2026-10"]?.income, 3000);
    assert.equal(restored?.budgets?.months["2026-10"]?.groups["eating-out"], 300);
    assert.equal(restored?.budgets?.months["2026-10"]?.categories.coffee, 60);

    const other = {
      ...EMPTY_LEDGER,
      budgets: setIncome(emptyBudgetBook(), "2026-11", 1000),
    };
    const merged = mergeLedgers(ledger, other);
    assert.equal(merged.budgets?.months["2026-10"]?.groups["eating-out"], 300);
    assert.equal(merged.budgets?.months["2026-11"]?.income, 1000);
  });
});

describe("budget page rows", () => {
  it("leaves Income and Transfers off the page and out of Spent", () => {
    applyBook(defaultCategoryBook());
    const book = defaultCategoryBook();
    const spent = spentByCategoryKey([
      txn({ id: "pay", amount: -500, categoryKey: "salary" }),
      txn({ id: "move", amount: -80, categoryKey: "transfers" }),
    ]);
    const lines = budgetGroupLines(book, monthPlan(emptyBudgetBook(), "2026-10"), spent);
    const categories = lines.flatMap((line) => line.categories);
    assert.equal(
      lines.some((line) => line.id === "income" || line.label === "Income"),
      false,
    );
    assert.equal(
      lines.some((line) => line.id === "transfers" || line.label === "Transfers"),
      false,
    );
    assert.equal(
      categories.some((category) => category.key === "transfers" || category.label === "Transfers"),
      false,
    );
    assert.equal(planTotals(lines).spent, 0);
  });

  it("counts an Investing debit in the Money moves ring and in Left to spend", () => {
    applyBook(defaultCategoryBook());
    const book = defaultCategoryBook();
    const plan = monthPlan(emptyBudgetBook(), "2026-10");
    const before = leftToSpend(0, planTotals(budgetGroupLines(book, plan, spentByCategoryKey([]))).spent);
    const spent = spentByCategoryKey([txn({ id: "inv", amount: -100, categoryKey: "invest", type: "invested" })]);
    const lines = budgetGroupLines(book, plan, spent);
    const moves = lines.find((line) => line.id === "money-moves");
    assert.ok(moves);
    assert.equal(moves.categories.some((category) => category.key === "invest"), true);
    assert.equal(moves.categories.some((category) => category.key === "debt-payments"), true);
    assert.equal(moves.categories.some((category) => category.key === "transfers"), false);
    assert.equal(moves.spent, 100);
    assert.equal(moves.ring.fill, 1);
    assert.equal(moves.ring.over, true);
    const after = leftToSpend(planTotals(lines).planned, planTotals(lines).spent);
    assert.equal(before.over, false);
    assert.equal(before.amount, 0);
    assert.equal(after.over, true);
    assert.equal(after.amount, 100);
    assert.equal(after.spent - before.spent, 100);

    const debt = spentByCategoryKey([
      txn({ id: "loan", amount: -40, categoryKey: "debt-payments", type: "repaid" }),
    ]);
    const debtLines = budgetGroupLines(book, plan, debt);
    const debtMoves = debtLines.find((line) => line.id === "money-moves");
    assert.equal(debtMoves?.spent, 40);
    assert.equal(leftToSpend(planTotals(debtLines).planned, planTotals(debtLines).spent).amount, 40);
  });

  it("shows Unsorted $3,509.75 without counting it in Left to spend", () => {
    applyBook(defaultCategoryBook());
    const book = defaultCategoryBook();
    const plan = monthPlan(setGroupAmount(emptyBudgetBook(), "2026-10", "unsorted", 500), "2026-10");
    const spent = spentByCategoryKey([
      txn({ id: "loose", amount: -3509.75, categoryKey: "uncategorised" }),
    ]);
    const lines = budgetGroupLines(book, plan, spent);
    const loose = unsortedSpent(book, spent);
    assert.equal(
      lines.some((line) => line.id === "unsorted" || line.label === "Unsorted"),
      false,
    );
    assert.equal(loose, 3509.75);
    assert.equal(formatAud(loose), "$3,509.75");
    const totals = planTotals(lines);
    assert.equal(totals.planned, 0);
    assert.equal(totals.spent, 0);
    const left = leftToSpend(totals.planned, totals.spent);
    assert.equal(left.amount, 0);
    assert.equal(left.over, false);
  });

  it("counts $40 spent in an unplanned category against Left to spend", () => {
    applyBook(defaultCategoryBook());
    const book = defaultCategoryBook();
    const plan = monthPlan(emptyBudgetBook(), "2026-10");
    const spent = spentByCategoryKey([txn({ id: "shop", amount: -40, categoryKey: "groceries" })]);
    const totals = planTotals(budgetGroupLines(book, plan, spent));
    const left = leftToSpend(totals.planned, totals.spent);
    assert.equal(totals.planned, 0);
    assert.equal(left.over, true);
    assert.equal(left.amount, 40);
    assert.equal(left.spent, 40);
  });
});
