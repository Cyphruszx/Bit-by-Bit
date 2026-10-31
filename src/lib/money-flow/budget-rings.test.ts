import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardBudgetCard } from "@/components/dashboard-budget-card";
import { formatAud } from "@/lib/format";
import { applyBook, defaultCategoryBook } from "@/lib/money-flow/category-book";
import {
  emptyBudgetBook,
  monthPlan,
  setCategoryAmount,
  setGroupAmount,
  spentByCategoryKey,
} from "@/lib/money-flow/budget-plan";
import {
  budgetStatusNote,
  categoryRingAria,
  dashboardRingCard,
  overallRingAria,
  ringInsideText,
  ringMoneyLabel,
  ringSummaryLine,
  sortPlannedRings,
  type PlannedRing,
} from "@/lib/money-flow/budget-rings";
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

function ring(partial: Partial<PlannedRing> & Pick<PlannedRing, "key" | "remainder" | "over">): PlannedRing {
  return {
    label: partial.key,
    spent: 0,
    planned: 0,
    ...partial,
  };
}

describe("ring formatting", () => {
  it("uses whole dollars with commas, <$1 under a dollar, and no plus when over", () => {
    assert.equal(ringMoneyLabel(64.85), "$65");
    assert.equal(ringMoneyLabel(1150.2), "$1,150");
    assert.equal(ringMoneyLabel(0.4), "<$1");
    assert.equal(ringMoneyLabel(0.99), "<$1");
    assert.equal(ringMoneyLabel(1), "$1");
    assert.equal(ringMoneyLabel(0), "$0");
    assert.equal(ringInsideText(64.85, true), "▲ $65 over");
    assert.equal(ringInsideText(64.85, true).includes("+"), false);
    assert.equal(ringInsideText(65.06, false), "$65 left");
    assert.equal(ringSummaryLine(13.55, true, 2020), "$14 over of $2,020");
    assert.equal(ringSummaryLine(65.06, false, 2690), "$65 left of $2,690");
  });

  it("describes a category ring with cents and an overall ring as left or over of the plan", () => {
    assert.equal(categoryRingAria("Dining", 214.85, 150), "Dining, $64.85 over, $214.85 of $150.00");
    assert.equal(overallRingAria(2690, 2624.94), `Budget, ${formatAud(65.06)} left of ${formatAud(2690)}`);
    assert.equal(categoryRingAria("Dining", 214.85, 150).includes("+"), false);
  });
});

describe("ring sorting", () => {
  it("puts the most over first, then the rings closest to their limit", () => {
    const sorted = sortPlannedRings([
      ring({ key: "close", remainder: 4, over: false }),
      ring({ key: "small-over", remainder: 10, over: true }),
      ring({ key: "room", remainder: 40, over: false }),
      ring({ key: "big-over", remainder: 30, over: true }),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.key),
      ["big-over", "small-over", "close", "room"],
    );
  });
});

describe("dashboard ring card states", () => {
  it("is empty when nothing is planned, even if categories have spending", () => {
    applyBook(defaultCategoryBook());
    const spent = spentByCategoryKey([txn({ id: "shop", amount: -40, categoryKey: "groceries" })]);
    const card = dashboardRingCard(defaultCategoryBook(), monthPlan(emptyBudgetBook(), "2026-10"), spent, "2026-10");
    assert.equal(card.status, "empty");
    const html = renderToStaticMarkup(createElement(DashboardBudgetCard, { card }));
    assert.match(html, /No budget yet/);
    assert.match(html, /Set amounts to track spending against them/);
    assert.match(html, /Set a budget/);
    assert.match(html, /href="\/budgeting"/);
    assert.equal(html.includes("left of"), false);
    assert.equal(html.includes("over of"), false);
  });

  it("counts planned categories only, lists the rest by spend, and keeps Unsorted out of the total", () => {
    applyBook(defaultCategoryBook());
    let stored = setCategoryAmount(emptyBudgetBook(), "2026-10", "groceries", 100);
    stored = setCategoryAmount(stored, "2026-10", "eating-out", 50);
    const spent = spentByCategoryKey([
      txn({ id: "shop", amount: -140, categoryKey: "groceries" }),
      txn({ id: "meal", amount: -20, categoryKey: "eating-out" }),
      txn({ id: "rent", amount: -80, categoryKey: "rent-mortgage" }),
      txn({ id: "bus", amount: -15, categoryKey: "getting-around" }),
      txn({ id: "loose", amount: -10, categoryKey: "uncategorised" }),
    ]);
    const card = dashboardRingCard(defaultCategoryBook(), monthPlan(stored, "2026-10"), spent, "2026-10");
    assert.equal(card.status, "ready");
    if (card.status !== "ready") return;
    assert.deepEqual(
      card.rings.map((item) => item.label),
      ["Groceries", "Eating Out"],
    );
    assert.equal(card.rings[0]?.over, true);
    assert.equal(card.rings[0]?.remainder, 40);
    assert.equal(card.planned, 150);
    assert.equal(card.spent, 160);
    assert.equal(card.over, true);
    assert.equal(card.remainder, 10);
    assert.equal(card.overCount, 1);
    assert.notEqual(card.spent, 160 + 80 + 15 + 10);
    assert.deepEqual(
      card.unplanned.map((row) => [row.label, row.spent, row.settable]),
      [
        ["Rent & Mortgage", 80, true],
        ["Getting Around", 15, true],
        ["Unsorted", 10, false],
      ],
    );
    assert.equal(budgetStatusNote(card.overCount, card.unplanned.length), "1 over budget · Planned categories only · 3 not planned");

    const html = renderToStaticMarkup(createElement(DashboardBudgetCard, { card }));
    assert.match(html, /Not planned yet · 3/);
    assert.match(html, /Planned categories only · 3 not planned/);
    assert.match(html, />Set</);
    assert.match(html, /Groceries, \$40\.00 over, \$140\.00 of \$100\.00/);
    assert.equal(html.includes("spent of"), false);
    assert.equal(html.includes("+"), false);
  });

  it("shows one ring for a group amount when its categories are blank", () => {
    applyBook(defaultCategoryBook());
    const stored = setGroupAmount(emptyBudgetBook(), "2026-10", "housing", 200);
    const spent = spentByCategoryKey([txn({ id: "rent", amount: -50, categoryKey: "rent-mortgage" })]);
    const card = dashboardRingCard(defaultCategoryBook(), monthPlan(stored, "2026-10"), spent, "2026-10");
    assert.equal(card.status, "ready");
    if (card.status !== "ready") return;
    assert.equal(card.rings.length, 1);
    assert.equal(card.rings[0]?.label, "Housing");
    assert.equal(card.planned, 200);
    assert.equal(card.spent, 50);
    assert.equal(card.over, false);
    assert.equal(card.unplanned.length, 0);
  });

  it("renders the load and error states without a total", () => {
    const empty = { status: "empty" } as const;
    const loading = renderToStaticMarkup(createElement(DashboardBudgetCard, { card: empty, status: "loading" }));
    assert.match(loading, /Loading your budget/);
    assert.equal(loading.includes("No budget yet"), false);
    const error = renderToStaticMarkup(
      createElement(DashboardBudgetCard, { card: empty, status: "error", onRetry: () => {} }),
    );
    assert.match(error, /Couldn&#x27;t load your budget\./);
    assert.match(error, /Check your connection, then try again\./);
    assert.match(error, /Try again/);
  });
});
