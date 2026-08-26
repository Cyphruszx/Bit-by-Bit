import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectRecurringOutflows, monthlyEquivalent, recurringFingerprint } from "./recurring";
import type { InterpretedTransaction } from "./types";

function txn(
  partial: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "merchant" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    category: "Other",
    date: "1 Aug",
    type: "expense",
    sourceFile: "demo",
    confidence: 1,
    ...partial,
  };
}

describe("recurring outflows", () => {
  it("groups similar money-out by merchant and amount", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Netflix", amount: -18.99, dateIso: "2026-07-03", category: "Subscriptions" }),
      txn({ id: "2", merchant: "Netflix", amount: -18.99, dateIso: "2026-08-03", category: "Subscriptions" }),
      txn({ id: "3", merchant: "Woolworths", amount: -86.4, dateIso: "2026-08-04", category: "Groceries" }),
      txn({ id: "4", merchant: "Salary", amount: 2620, dateIso: "2026-08-18", type: "income", category: "Income" }),
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0].merchant, "Netflix");
    assert.equal(found[0].typicalAmount, 18.99);
    assert.equal(found[0].cadence, "monthly");
    assert.equal(found[0].suggested, false);
    assert.equal(recurringFingerprint("Netflix", 18.99), "netflix|19");
  });

  it("suggests a one-off bill-like payment", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Rent Payment Smith", amount: -980, dateIso: "2026-08-15", category: "Housing" }),
    ]);
    assert.equal(found[0].suggested, true);
    assert.equal(found[0].cadence, "monthly");
    assert.equal(monthlyEquivalent(100, "weekly"), 433.33);
  });

  it("skips savings transfers", () => {
    const found = detectRecurringOutflows([
      txn({ id: "1", merchant: "Transfer To Savings", amount: -400, dateIso: "2026-08-12", type: "transfer", category: "Goals" }),
      txn({ id: "2", merchant: "Transfer To Savings", amount: -400, dateIso: "2026-08-26", type: "transfer", category: "Goals" }),
    ]);
    assert.equal(found.length, 0);
  });
});
