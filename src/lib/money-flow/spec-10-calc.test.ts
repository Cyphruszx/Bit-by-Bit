/**
 * Spec 10 tile math (Slice 1). These are the asserts Steven/Dev named for calc truth:
 * Net Money, unlinked-refund-not-Income, month-freeze, Sydney month bounds,
 * CLEARED `base_amount` tiles, and Actual Savings shape.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksReturned } from "./statement-category";
import {
  calendarDate,
  filterByPeriod,
  formatMonthLabel,
  inPeriod,
  monthBounds,
  monthKey,
  summarizePeriod,
} from "./period";
import { isEarnings, isRefundCredit, isSpending, summarizeMoneyFlow, tileAmount } from "./summary";
import { interpretMovement } from "./interpret-row";
import { upgradeTransaction } from "./upgrade";
import type { InterpretedTransaction } from "./types";

function txn(over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">): InterpretedTransaction {
  const amount = over.amount;
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? (amount > 0 ? "salary" : "groceries"),
    date: over.dateIso,
    type: over.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

describe("Spec 10 Net Money", () => {
  it("is Income − Spending + Refund credits, not income minus spending alone", () => {
    const paid = txn({ id: "paid", amount: -80, dateIso: "2026-03-03", merchant: "Kmart Wagga", type: "spent" });
    const refund = txn({
      id: "back",
      amount: 80,
      dateIso: "2026-03-04",
      merchant: "Kmart Wagga",
      type: "returned",
      refundPair: "paid~back",
      bank: { type: "Refund" },
    });
    const salary = txn({ id: "pay", amount: 3000, dateIso: "2026-03-06", merchant: "Acme Payroll", type: "earned", categoryKey: "salary" });
    const shop = txn({ id: "shop", amount: -40, dateIso: "2026-03-05", merchant: "Woolworths", type: "spent" });
    paid.refundPair = "paid~back";

    const flow = summarizeMoneyFlow([paid, refund, salary, shop]);
    assert.equal(flow.income, 3000);
    assert.equal(flow.spending, 120, "the original payment still sits in Spending");
    assert.equal(flow.refunds, 80, "linked refund credit is its own addend");
    assert.equal(flow.net, 3000 - 120 + 80);
    assert.equal(flow.net, flow.income - flow.spending + flow.refunds);
    assert.notEqual(flow.net, flow.income - flow.spending);
  });
});

describe("Spec 10 unlinked refund-shaped credits are not Income", () => {
  it("keeps an unlinked bank-Refund credit out of Income and out of Refund credits", () => {
    const refundShaped = txn({
      id: "orphan",
      amount: 7.9,
      dateIso: "2026-07-31",
      merchant: "Soul Origin",
      categoryKey: "uncategorised",
      type: "earned",
      bank: { type: "Refund" },
      description: "Refund +$7.90",
    });
    const salary = txn({ id: "pay", amount: 300, dateIso: "2026-07-31", merchant: "Jane Citizen", type: "earned", categoryKey: "salary" });

    assert.equal(looksReturned(refundShaped), true);
    assert.equal(isEarnings(refundShaped), false);
    assert.equal(isRefundCredit(refundShaped), false);

    const flow = summarizeMoneyFlow([refundShaped, salary]);
    assert.equal(flow.income, 300);
    assert.equal(flow.refunds, 0);
    assert.equal(flow.net, 300);
  });

  it("still counts a filed earnings credit the bank happened to label Refund", () => {
    const medicare = txn({
      id: "mcare",
      amount: 662.4,
      dateIso: "2026-06-29",
      merchant: "MCARE BENEFITS",
      categoryKey: "other-income",
      type: "earned",
      bank: { category: "Refund" },
      decidedBy: "rules",
    });
    assert.equal(looksReturned(medicare), true);
    assert.equal(isEarnings(medicare), true);
    assert.equal(summarizeMoneyFlow([medicare]).income, 662.4);
  });
});

describe("Spec 10 month-freeze", () => {
  it("does not reduce the spend-month when a later refund is linked", () => {
    const paid = txn({
      id: "paid",
      amount: -100,
      dateIso: "2026-02-20",
      merchant: "Domino Pizza",
      type: "spent",
      refundPair: "paid~back",
    });
    const refund = txn({
      id: "back",
      amount: 100,
      dateIso: "2026-03-04",
      merchant: "Domino Pizza",
      type: "returned",
      refundPair: "paid~back",
      bank: { type: "Refund" },
    });
    const rows = [paid, refund];

    const february = summarizePeriod(rows, { kind: "month", month: "2026-02" });
    assert.equal(february.spending, 100, "February spending stays 100 after the March link");
    assert.equal(february.income, 0);
    assert.equal(february.refunds, 0, "refund date is not in February");
    assert.equal(february.net, -100);

    const march = summarizePeriod(rows, { kind: "month", month: "2026-03" });
    assert.equal(march.spending, 0, "March spending is not rewritten");
    assert.equal(march.income, 0, "the credit is Refund credits, never Income");
    assert.equal(march.refunds, 100);
    assert.equal(march.net, 100);

    const all = summarizePeriod(rows, { kind: "all" });
    assert.equal(all.spending, 100);
    assert.equal(all.refunds, 100);
    assert.equal(all.net, 0);
  });
});

describe("Spec 10 Australia/Sydney month bounds", () => {
  it("treats a YYYY-MM-DD row date as that Sydney calendar day, not a UTC instant", () => {
    assert.equal(calendarDate("2026-08-31"), "2026-08-31");
    assert.equal(monthKey("2026-08-31"), "2026-08");
    assert.equal(inPeriod("2026-08-31", { kind: "month", month: "2026-08" }), true);
    assert.equal(inPeriod("2026-09-01", { kind: "month", month: "2026-08" }), false);
    assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthBounds("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
    assert.equal(formatMonthLabel("2026-08"), "August 2026");
  });

  it("assigns instants by Australia/Sydney, including the UTC afternoon that is already the next Sydney day", () => {
    // August is AEST (UTC+10): 31 Aug 14:00 UTC is 1 Sep 00:00 in Sydney.
    assert.equal(calendarDate("2026-08-31T14:00:00.000Z"), "2026-09-01");
    assert.equal(monthKey("2026-08-31T14:00:00.000Z"), "2026-09");
    assert.equal(inPeriod("2026-08-31T14:00:00.000Z", { kind: "month", month: "2026-08" }), false);
    assert.equal(inPeriod("2026-08-31T14:00:00.000Z", { kind: "month", month: "2026-09" }), true);
    // February is AEDT (UTC+11): 28 Feb 13:00 UTC is 1 Mar 00:00 in Sydney.
    assert.equal(calendarDate("2026-02-28T13:00:00.000Z"), "2026-03-01");
    assert.equal(monthKey("2026-02-28T13:00:00.000Z"), "2026-03");
  });

  it("filters a Sydney month from row dates without using the device timezone", () => {
    const rows = [
      txn({ id: "aug", amount: -10, dateIso: "2026-08-31" }),
      txn({ id: "sep", amount: -10, dateIso: "2026-09-01" }),
    ];
    assert.deepEqual(
      filterByPeriod(rows, { kind: "month", month: "2026-08" }).map((row) => row.id),
      ["aug"],
    );
  });
});

describe("Spec 10 earnings vs spending helpers", () => {
  it("never treats a linked refund credit as spending or income", () => {
    const credit = txn({
      id: "back",
      amount: 50,
      dateIso: "2026-04-02",
      type: "returned",
      refundPair: "a~b",
    });
    assert.equal(isEarnings(credit), false);
    assert.equal(isSpending(credit), false);
    assert.equal(isRefundCredit(credit), true);
  });
});

describe("Spec 10 base_amount and CLEARED tiles", () => {
  it("treats missing status as CLEARED and missing base_amount as amount", () => {
    const salary = txn({ id: "pay", amount: 300, dateIso: "2026-03-06", type: "earned", categoryKey: "salary" });
    const shop = txn({ id: "shop", amount: -40, dateIso: "2026-03-05", type: "spent" });
    const flow = summarizeMoneyFlow([salary, shop]);
    assert.equal(tileAmount(salary), 300);
    assert.equal(flow.income, 300);
    assert.equal(flow.spending, 40);
    assert.equal(flow.net, 260);
  });

  it("sums base_amount on tiles when it differs from amount", () => {
    const salary = txn({
      id: "pay",
      amount: 3000,
      baseAmount: 2500,
      dateIso: "2026-03-06",
      type: "earned",
      categoryKey: "salary",
    });
    const shop = txn({
      id: "shop",
      amount: -80,
      baseAmount: -50,
      dateIso: "2026-03-05",
      type: "spent",
    });
    const flow = summarizeMoneyFlow([salary, shop]);
    assert.equal(flow.income, 2500);
    assert.equal(flow.spending, 50);
    assert.equal(flow.net, 2450);
    assert.equal(flow.cashIn, 3000, "cash still ties to statement amount");
    assert.equal(flow.cashOut, 80);
  });

  it("excludes HOLD rows from Income, Spending, Net, and Refund credits", () => {
    const salary = txn({ id: "pay", amount: 3000, dateIso: "2026-03-06", type: "earned", categoryKey: "salary" });
    const heldPay = txn({
      id: "held-pay",
      amount: 500,
      dateIso: "2026-03-07",
      type: "earned",
      categoryKey: "salary",
      status: "HOLD",
    });
    const shop = txn({ id: "shop", amount: -40, dateIso: "2026-03-05", type: "spent" });
    const heldShop = txn({
      id: "held-shop",
      amount: -90,
      dateIso: "2026-03-08",
      type: "spent",
      status: "HOLD",
    });
    const refund = txn({
      id: "back",
      amount: 20,
      dateIso: "2026-03-09",
      type: "returned",
      refundPair: "paid~back",
      status: "HOLD",
    });
    const flow = summarizeMoneyFlow([salary, heldPay, shop, heldShop, refund]);
    assert.equal(flow.income, 3000);
    assert.equal(flow.spending, 40);
    assert.equal(flow.refunds, 0);
    assert.equal(flow.net, 2960);
    assert.equal(flow.cashIn, 3520, "HOLD still sits on the statement cash figures");
  });

  it("commits base_amount = amount and CLEARED on interpret", () => {
    const row = interpretMovement({
      dateIso: "2026-06-01",
      amount: -15.4,
      directionKnown: true,
      description: "XYZ MART 999",
      bankCategory: "Groceries",
      sourceFile: "nab.csv",
      id: "1",
      confidence: 0.92,
    });
    assert.equal(row.baseAmount, row.amount);
    assert.equal(row.status, "CLEARED");
  });

  it("fills CLEARED and base_amount when a stored row has neither", () => {
    const upgraded = upgradeTransaction({
      id: "row-1",
      merchant: "Kfc",
      categoryKey: "eating-out",
      date: "30 Jun",
      dateIso: "2026-06-30",
      amount: -14.95,
      sourceFile: "up.txt",
      confidence: 0.9,
    });
    assert.equal(upgraded.baseAmount, -14.95);
    assert.equal(upgraded.status, "CLEARED");
  });
});

describe("Spec 10 Actual Savings", () => {
  it("counts a CLEARED TRANSFER IN to Save!! and ignores the outflow and a spending-account IN", () => {
    const out = txn({
      id: "out",
      amount: -400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      accountId: "Up · Spending",
    });
    const intoSave = txn({
      id: "in-save",
      amount: 400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      accountId: "Up · Save!!",
    });
    const intoSpend = txn({
      id: "in-spend",
      amount: 80,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-spend",
      accountId: "Up · Spending",
    });
    const spendOut = txn({
      id: "spend-out",
      amount: -80,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-spend",
      accountId: "Up · Tax",
    });
    const flow = summarizeMoneyFlow([out, intoSave, intoSpend, spendOut]);
    assert.equal(flow.transfers, 480);
    assert.equal(flow.actualSavings, 400);
    assert.equal(flow.income, 0);
    assert.equal(flow.spending, 0);
  });

  it("does not count unmatched internals or HOLD credits as Actual Savings", () => {
    const unmatched = txn({
      id: "orphan",
      amount: 200,
      dateIso: "2026-03-12",
      type: "moved",
      accountId: "Up · Save!!",
    });
    const held = txn({
      id: "held",
      amount: 150,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-held",
      accountId: "Up · Save!!",
      status: "HOLD",
    });
    const heldOut = txn({
      id: "held-out",
      amount: -150,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-held",
      accountId: "Up · Spending",
      status: "HOLD",
    });
    const flow = summarizeMoneyFlow([unmatched, held, heldOut]);
    assert.equal(flow.actualSavings, 0);
  });

  it("counts a user-flagged TRANSFER IN even when the destination name is not savings", () => {
    const out = txn({
      id: "out",
      amount: -90,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-flag",
      accountId: "Up · Spending",
    });
    const flagged = txn({
      id: "flag",
      amount: 90,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-flag",
      accountId: "Up · Tax",
      userFlaggedSavings: true,
    });
    const flow = summarizeMoneyFlow([out, flagged]);
    assert.equal(flow.actualSavings, 90);
    assert.equal(flow.transfers, 90);
  });
});
