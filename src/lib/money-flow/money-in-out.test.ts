/**
 * Money in and Money out are what the Transactions cards add up.
 * They use the same cleared rows Income and Spending are allowed to count:
 * not a duplicate hold, not pending, and not sitting in Review. A loan can
 * still be money in. Money moved between your own accounts stays out.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moneyInOutRows, summarizeMoneyFlow } from "./summary";
import type { InterpretedTransaction } from "./types";

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount">,
): InterpretedTransaction {
  const amount = over.amount;
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? (amount > 0 ? "salary" : "groceries"),
    date: "2026-10-06",
    dateIso: "2026-10-06",
    type: over.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: "nab.csv",
    confidence: 1,
    status: "CLEARED",
    ...over,
  };
}

describe("Money in and Money out", () => {
  it("counts cleared money and leaves out duplicate holds, pending, review, and own-account transfers", () => {
    const salary = txn({
      id: "pay",
      amount: 3200,
      merchant: "Northwind Pty Ltd",
      categoryKey: "salary",
      type: "INCOME",
      verdict: { because: "earned", counts: true, at: "2026-10-01T00:00:00.000Z" },
    });
    const loan = txn({
      id: "loan",
      amount: 8000,
      merchant: "SocietyOne",
      categoryKey: "uncategorised",
      type: "DEBT_PRINCIPAL",
      verdict: { because: "borrowed", counts: false, at: "2026-10-01T00:00:00.000Z" },
    });
    const shop = txn({ id: "shop", amount: -54.2, merchant: "Woolworths", categoryKey: "groceries" });
    const pending = txn({ id: "pending", amount: -80, merchant: "Ampol", status: "PENDING" });
    const duplicate = txn({ id: "dup", amount: -15, merchant: "Coles", status: "DUPLICATE_HOLD" });
    const held = txn({ id: "held", amount: 500, merchant: "Held credit", status: "HOLD", categoryKey: "other-income" });
    const toSaver = txn({
      id: "to-saver",
      amount: -200,
      merchant: "Transfer to Saver",
      type: "TRANSFER",
      categoryKey: "transfers",
      transferPair: "pocket",
    });
    const fromSpend = txn({
      id: "from-spend",
      amount: 200,
      merchant: "Transfer from Everyday",
      type: "TRANSFER",
      categoryKey: "transfers",
      transferPair: "pocket",
    });
    const reviewDebit = txn({
      id: "out",
      amount: -400,
      merchant: "Transfer To Save!!",
      categoryKey: "uncategorised",
      accountId: "Up · Spending",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const reviewCredit = txn({
      id: "in-save",
      amount: 400,
      merchant: "Transfer From Spending",
      categoryKey: "uncategorised",
      type: "earned",
      accountId: "Up · Save!!",
      bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
    });

    const rows = [salary, loan, shop, pending, duplicate, held, toSaver, fromSpend, reviewDebit, reviewCredit];
    const counted = moneyInOutRows(rows).map((row) => row.id).sort();
    assert.deepEqual(counted, ["loan", "pay", "shop"]);

    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 11200, "salary and the loan arrived; the held credit and the transfer did not");
    assert.equal(flow.cashOut, 54.2, "only the cleared shop; pending, duplicate, and review debits stay out");
    assert.equal(flow.income, 3200, "the loan is money in and not income");
    assert.equal(
      flow.categories.reduce((sum, row) => sum + row.amount, 0),
      54.2,
      "spending is the same cleared shop",
    );
  });
});
