import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeScope, EVERYTHING, filterByScope, parseScope, parseScopeView, scopeLabel } from "./scope";
import type { InterpretedTransaction } from "./types";

let made = 0;

function move(accountId: string, amount: number): InterpretedTransaction {
  made += 1;
  const institution = accountId.split(" · ")[0];
  return {
    id: `m${made}`,
    merchant: "Cafe",
    category: "Dining",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type: amount < 0 ? "expense" : "income",
    sourceFile: `${institution}.csv`,
    institution,
    accountId,
    confidence: 1,
  };
}

const rows = [
  move("NAB · 100200300", -50),
  move("NAB · 400500600", 50),
  move("Up · Spending", -8),
];

describe("choosing what to look at", () => {
  it("shows everything by default", () => {
    assert.equal(filterByScope(rows, EVERYTHING).length, 3);
    assert.equal(scopeLabel(EVERYTHING), "Everything");
  });

  it("narrows to one bank, keeping every account inside it", () => {
    const nab = filterByScope(rows, { kind: "institution", institution: "NAB" });
    assert.equal(nab.length, 2);
  });

  it("narrows to one account", () => {
    const everyday = filterByScope(rows, { kind: "account", accountId: "NAB · 100200300" });
    assert.equal(everyday.length, 1);
    assert.equal(everyday[0].amount, -50);
  });

  it("follows an account through the name a person gave it", () => {
    const named = { names: { "NAB · 100200300": "Everyday" } };
    assert.equal(filterByScope(rows, { kind: "account", accountId: "NAB · Everyday" }, named).length, 1);
  });

  it("shortens an account number in the label", () => {
    assert.equal(scopeLabel({ kind: "account", accountId: "NAB · 100200300" }), "NAB · ···300");
  });

  it("says why a bank's own figures are not the household's", () => {
    assert.match(describeScope({ kind: "institution", institution: "NAB" }), /still counts as leaving/);
    assert.match(describeScope(EVERYTHING), /counted once/);
  });
});

describe("remembering what to look at", () => {
  const known = { institutions: ["NAB"], accounts: ["NAB · 100200300"] };

  it("keeps a scope that still names something held", () => {
    assert.deepEqual(parseScope({ kind: "institution", institution: "NAB" }, known), {
      kind: "institution",
      institution: "NAB",
    });
    assert.deepEqual(parseScope({ kind: "account", accountId: "NAB · 100200300" }, known), {
      kind: "account",
      accountId: "NAB · 100200300",
    });
  });

  it("falls back to everything when what it named has gone", () => {
    // The statement that account came from was removed.
    assert.deepEqual(parseScope({ kind: "account", accountId: "NAB · 999" }, known), EVERYTHING);
    assert.deepEqual(parseScope({ kind: "institution", institution: "ANZ" }, known), EVERYTHING);
  });

  it("survives whatever an older version of the app stored", () => {
    assert.deepEqual(parseScope({ kind: "file", sourceFile: "nab.csv" }, known), EVERYTHING);
    assert.deepEqual(parseScope(null, known), EVERYTHING);
    assert.deepEqual(parseScope("nonsense", known), EVERYTHING);
    assert.equal(parseScopeView("file"), "together");
    assert.equal(parseScopeView("separate"), "separate");
  });
});
