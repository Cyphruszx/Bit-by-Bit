import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountIdOf, accountLabel, accountsFrom, identifyAccounts } from "./accounts";
import type { InterpretedTransaction } from "./types";

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: `t${Math.random()}`,
    merchant: "Cafe",
    category: "Dining",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -4.5,
    type: "expense",
    sourceFile: "statement.csv",
    confidence: 1,
    ...over,
  };
}

describe("naming an account", () => {
  it("puts the bank in front of the account the statement named", () => {
    const [row] = identifyAccounts([txn({ accountId: "Tax" })], "Up");
    assert.equal(row.accountId, "Up · Tax");
    assert.equal(row.institution, "Up");
  });

  it("uses the account number when that is all the export gives", () => {
    assert.equal(identifyAccounts([txn({ accountKey: "100200300" })], "NAB")[0].accountId, "NAB · 100200300");
  });

  it("keeps two banks using the same account number apart", () => {
    const nab = identifyAccounts([txn({ accountKey: "100200300" })], "NAB")[0];
    const anz = identifyAccounts([txn({ accountKey: "100200300" })], "ANZ")[0];
    assert.notEqual(accountIdOf(nab), accountIdOf(anz));
  });

  it("leaves the account alone when nothing names the bank or the account", () => {
    assert.equal(identifyAccounts([txn()], undefined)[0].accountId, undefined);
  });

  it("falls back to the bank, then the statement, so a movement always belongs somewhere", () => {
    assert.equal(accountIdOf(txn({ institution: "NAB" })), "NAB");
    assert.equal(accountIdOf(txn()), "statement.csv");
  });

  it("shortens an account number rather than reciting it", () => {
    assert.equal(accountLabel("NAB · 100200300"), "NAB · ···300");
    assert.equal(accountLabel("Up · Tax"), "Up · Tax");
  });
});

describe("account totals", () => {
  const rows = [
    txn({ id: "a", accountId: "NAB · 100200300", institution: "NAB", amount: 500, type: "income" }),
    txn({ id: "b", accountId: "NAB · 100200300", institution: "NAB", amount: -120 }),
    txn({ id: "c", accountId: "NAB · 400500600", institution: "NAB", amount: -380 }),
    txn({ id: "d", accountId: "Up · Tax", institution: "Up", amount: 60, type: "income" }),
  ];

  it("gives every account its own flow", () => {
    const accounts = accountsFrom(rows);
    assert.deepEqual(accounts.map((account) => account.id), [
      "NAB · 100200300",
      "NAB · 400500600",
      "Up · Tax",
    ]);
    assert.equal(accounts[0].flow.cashNet, 380);
    assert.equal(accounts[1].institution, "NAB");
  });

  it("adds up to the same money as the movements it grouped", () => {
    const accounts = accountsFrom(rows);
    assert.equal(
      accounts.reduce((sum, account) => sum + account.flow.cashNet, 0),
      60,
    );
    assert.equal(
      accounts.reduce((sum, account) => sum + account.transactions.length, 0),
      rows.length,
    );
  });
});
