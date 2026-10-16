import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAud } from "@/lib/format";
import { EMPTY_LEDGER, mergeLedgers, parseLedger } from "@/lib/money-flow/ledger";
import {
  countedGroupAmount,
  groupShortfall,
  leftToPlan,
  leftToSpend,
  ringRead,
  setCategoryAmount,
  setGroupAmount,
  setIncome,
  emptyBudgetBook,
} from "@/lib/money-flow/budget-plan";

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
