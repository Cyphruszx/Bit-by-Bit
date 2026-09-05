import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountIdOf,
  accountLabel,
  accountsByInstitution,
  accountsFrom,
  identifyAccounts,
  observedAccountKey,
  suggestNameForKey,
} from "./accounts";
import type { InterpretedTransaction } from "./types";

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: `t${Math.random()}`,
    merchant: "Cafe",
    categoryKey: "food",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -4.5,
    type: "spent",
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

  it("takes the account off the letterhead when the movements name none", () => {
    const [row] = identifyAccounts([txn()], "NAB", { number: "100200300" });
    assert.equal(row.accountId, "NAB · 100200300");
  });

  it("gives a statement that names no account one of its own", () => {
    // Two statements from one bank stay two accounts, so a transfer between them can
    // still be found. Merging them is the person's call, not a guess.
    const first = identifyAccounts([txn({ sourceFile: "cba-may.csv" })], "Commonwealth Bank")[0];
    const second = identifyAccounts([txn({ sourceFile: "cba-june.csv" })], "Commonwealth Bank")[0];

    assert.equal(first.accountId, "Commonwealth Bank · cba-may.csv");
    assert.notEqual(accountIdOf(first), accountIdOf(second));
  });

  it("still files a movement somewhere when nothing names the bank either", () => {
    assert.equal(observedAccountKey(txn()), "Unknown source · statement.csv");
  });

  it("shortens an account number rather than reciting it", () => {
    assert.equal(accountLabel("NAB · 100200300"), "NAB · ···300");
    assert.equal(accountLabel("Up · Tax"), "Up · Tax");
  });
});

describe("account totals", () => {
  const rows = [
    txn({ id: "a", accountId: "NAB · 100200300", institution: "NAB", amount: 500, type: "earned" }),
    txn({ id: "b", accountId: "NAB · 100200300", institution: "NAB", amount: -120 }),
    txn({ id: "c", accountId: "NAB · 400500600", institution: "NAB", amount: -380 }),
    txn({ id: "d", accountId: "Up · Tax", institution: "Up", amount: 60, type: "earned" }),
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

describe("naming and merging accounts", () => {
  const nabNumber = txn({ accountId: "NAB · 100200300", institution: "NAB", amount: -50 });
  const nabMasked = txn({ accountId: "NAB · ···300", institution: "NAB", amount: -20 });

  it("shows the name a person gave in place of the number", () => {
    const named = { "NAB · 100200300": "Everyday" };
    assert.equal(accountIdOf(nabNumber, { names: named }), "NAB · Everyday");
  });

  it("makes two keys one account when both are given the same name", () => {
    const named = { "NAB · 100200300": "Everyday", "NAB · ···300": "Everyday" };
    const accounts = accountsFrom([nabNumber, nabMasked], { names: named });

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].transactions.length, 2);
    assert.deepEqual(accounts[0].keys.sort(), ["NAB · 100200300", "NAB · ···300"]);
    assert.equal(accounts[0].named, true);
  });

  it("keeps them apart until someone says otherwise", () => {
    assert.equal(accountsFrom([nabNumber, nabMasked]).length, 2);
  });

  it("suggests a name worth accepting", () => {
    assert.equal(suggestNameForKey("NAB · 100200300", "nab.csv"), "NAB ···300");
    assert.equal(suggestNameForKey("Up · Tax", "up.txt"), "Tax");
    assert.equal(
      suggestNameForKey("Commonwealth Bank · cba-may.csv", "cba-may.csv"),
      "Commonwealth Bank · cba may",
    );
  });

  it("sorts accounts under the bank they belong to", () => {
    const grouped = accountsByInstitution([
      nabNumber,
      txn({ accountId: "Up · Tax", institution: "Up", amount: 5 }),
      txn({ accountId: "Up · Spending", institution: "Up", amount: -5 }),
    ]);

    // Busiest bank first, so a new statement cannot reshuffle the row of chips.
    assert.deepEqual(
      grouped.map((row) => [row.institution, row.accounts.length]),
      [["Up", 2], ["NAB", 1]],
    );
  });
});
