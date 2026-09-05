import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCadence, advanceAfterPaid, detectRecurringOutflows, expectedOccurrence, monthlyEquivalent, nextDateFromLast, paymentMatches, recurringFingerprint, trackedInPeriod, trackingSnapshot } from "./recurring";
import type { InterpretedTransaction } from "./types";

function txn(
  partial: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "merchant" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    categoryKey: "uncategorised",
    date: "1 Aug",
    type: "spent",
    sourceFile: "demo",
    confidence: 1,
    ...partial,
  };
}

describe("recurring outflows", () => {
  it("groups similar money-out by merchant and amount", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Netflix", amount: -18.99, dateIso: "2026-07-03", categoryKey: "leisure" }),
      txn({ id: "2", merchant: "Netflix", amount: -18.99, dateIso: "2026-08-03", categoryKey: "leisure" }),
      txn({ id: "3", merchant: "Woolworths", amount: -86.4, dateIso: "2026-08-04", categoryKey: "food" }),
      txn({ id: "4", merchant: "Salary", amount: 2620, dateIso: "2026-08-18", type: "earned", categoryKey: "income" }),
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0].merchant, "Netflix");
    assert.equal(found[0].typicalAmount, 18.99);
    assert.equal(found[0].cadence, "monthly");
    assert.equal(found[0].suggested, false);
    assert.deepEqual(found[0].dates, ["2026-07-03", "2026-08-03"]);
    assert.equal(recurringFingerprint("Netflix", 18.99), "netflix|19");
  });

  it("suggests a one-off bill-like payment", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Rent Payment Smith", amount: -980, dateIso: "2026-08-15", categoryKey: "home" }),
    ]);
    assert.equal(found[0].suggested, true);
    assert.equal(found[0].cadence, "monthly");
    assert.equal(monthlyEquivalent(100, "weekly"), 433.33);
  });

  it("skips savings transfers", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Transfer To Savings", amount: -400, dateIso: "2026-08-12", type: "moved", categoryKey: "uncategorised" }),
      txn({ id: "2", merchant: "Transfer To Savings", amount: -400, dateIso: "2026-08-26", type: "moved", categoryKey: "uncategorised" }),
    ]);
    assert.equal(found.length, 0);
  });

  it("advances the last payment date to the next occurrence", () => {
    assert.equal(nextDateFromLast("2026-08-03", "monthly", "2026-08-26"), "2026-09-03");
    assert.equal(nextDateFromLast("2026-08-20", "weekly", "2026-08-26"), "2026-08-27");
    assert.equal(nextDateFromLast("2026-09-01", "monthly", "2026-08-26"), "2026-09-01");
    assert.equal(advanceAfterPaid("2026-08-15", "monthly", "2026-08-26"), "2026-09-15");
    assert.equal(nextDateFromLast("2026-01-31", "monthly", "2026-02-05"), "2026-02-28");
    assert.equal(advanceAfterPaid("2026-01-31", "monthly", "2026-02-05"), "2026-02-28");
    assert.equal(advanceAfterPaid("2026-01-31", "monthly", "2026-03-05"), "2026-03-31");
    assert.equal(expectedOccurrence("2026-03-31", "monthly", "2026-02-01", "2026-02-28"), "2026-02-28");
    assert.equal(addCadence("2026-01-31", "monthly"), "2026-02-28");
    assert.equal(addCadence("2024-01-31", "monthly"), "2024-02-29");
  });

  it("matches tracked payments to activity without double-counting transfers", () => {
    const item = {
      fingerprint: recurringFingerprint("Netflix", 18.99),
      name: "Netflix",
      amount: 18.99,
      cadence: "monthly" as const,
      nextDate: "2026-09-03",
    };
    assert.equal(
      paymentMatches(item, txn({ id: "1", merchant: "Netflix", amount: -18.99, dateIso: "2026-08-03" })),
      true,
    );
    assert.equal(
      paymentMatches(item, txn({ id: "2", merchant: "Woolworths", amount: -18.99, dateIso: "2026-08-03" })),
      false,
    );
  });

  it("keeps tracking a payment in the month it was paid, even if the next date is later", () => {
    const item = {
      fingerprint: recurringFingerprint("Rent", 980),
      name: "Rent",
      amount: 980,
      cadence: "monthly" as const,
      nextDate: "2026-09-15",
    };
    const rows = [
      txn({ id: "1", merchant: "Rent", amount: -980, dateIso: "2026-08-15", categoryKey: "home" }),
    ];
    assert.equal(trackedInPeriod(item, { kind: "month", month: "2026-08" }, rows), true);
    assert.equal(trackingSnapshot(item, rows, { kind: "month", month: "2026-08" }, "2026-08-26").status, "paid");
    assert.equal(trackingSnapshot(item, rows, { kind: "all" }, "2026-08-26").status, "upcoming");
  });

  it("marks a tracked payment overdue when nothing has matched since the due date", () => {
    const item = {
      fingerprint: "custom:gym",
      name: "Gym",
      amount: 40,
      cadence: "monthly" as const,
      nextDate: "2026-08-01",
    };
    const snap = trackingSnapshot(item, [], { kind: "all" }, "2026-08-26");
    assert.equal(snap.status, "overdue");
    assert.equal(trackedInPeriod(item, { kind: "month", month: "2026-09" }, []), true);
  });
});
