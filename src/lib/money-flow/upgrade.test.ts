import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fingerprintOf } from "./ledger";
import { sourceFromPairs } from "./source";
import { storedInCurrentModel, upgradeTransaction, type StoredTransaction } from "./upgrade";

function stored(over: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id: "row-1",
    merchant: "Kfc",
    categoryKey: "eating-out",
    date: "30 Jun",
    dateIso: "2026-06-30",
    amount: -14.95,
    sourceFile: "up.txt",
    confidence: 0.9,
    ...over,
  } as StoredTransaction;
}

describe("a movement stored before its bank named it", () => {
  it("recovers the name Up printed from the block kept beside it", () => {
    const row = stored({
      merchant: "Kfc",
      description: "KFC Wagga Wagga, NSW KFC WAGGA NORTH, WAGGA WAGGA Purchase",
      source: sourceFromPairs([
        ["Date", "2026-06-30"],
        ["Lines", "8:37pm KFC\nWagga Wagga, NSW KFC WAGGA NORTH, WAGGA WAGGA Purchase\nZap Card **1234 $14.95 $177.64"],
      ]),
    });
    assert.equal(upgradeTransaction(row).merchant, "KFC");
  });

  it("recovers the person behind a payment rail", () => {
    const row = stored({
      merchant: "Osko Payment Received",
      description: "Osko Payment Received JORDAN LEE Osko Payment Received",
      amount: 200,
      source: sourceFromPairs([
        ["Lines", "6:45pm Osko Payment Received\nJORDAN LEE Osko Payment Received +$200.00 $205.59"],
      ]),
    });
    assert.equal(upgradeTransaction(row).merchant, "JORDAN LEE");
  });

  it("prefers the cell NAB named the shop in", () => {
    const row = stored({
      merchant: "Woolworths 12731 Wagga",
      description: "WOOLWORTHS 12731 WAGGA",
      sourceFile: "nab.csv",
      source: sourceFromPairs([
        ["Merchant Name", "Woolworths (Wagga Wagga North)"],
        ["Transaction Details", "WOOLWORTHS 12731 WAGGA"],
      ]),
    });
    assert.equal(upgradeTransaction(row).merchant, "Woolworths (Wagga Wagga North)");
  });

  it("falls back to what NAB wrote in the details when it named no shop", () => {
    const row = stored({
      merchant: "Jordan Lee H4756108521",
      description: "JORDAN LEE H4756108521",
      sourceFile: "nab.csv",
      source: sourceFromPairs([
        ["Merchant Name", ""],
        ["Transaction Details", "JORDAN LEE H4756108521"],
      ]),
    });
    assert.equal(upgradeTransaction(row).merchant, "JORDAN LEE H4756108521");
  });

  it("uses the bank's own merchant when the cells never arrived", () => {
    const row = stored({
      merchant: "Woolworths 12731 Wagga",
      description: "WOOLWORTHS 12731 WAGGA",
      bank: { merchant: "Woolworths (Wagga Wagga North)" },
    });
    assert.equal(upgradeTransaction(row).merchant, "Woolworths (Wagga Wagga North)");
  });
});

describe("what recovering a name is not allowed to touch", () => {
  it("leaves a movement identified by its name alone completely alone", () => {
    // A loose text statement, OFX and QIF set no description, so the fingerprint falls back
    // to the merchant. Moving the name there would import the same money a second time.
    const row = stored({
      merchant: "Kfc",
      sourceFile: "statement.pdf",
      source: sourceFromPairs([["Description", "KFC WAGGA NORTH"]]),
    });
    delete (row as { description?: string }).description;
    assert.equal(upgradeTransaction(row).merchant, "Kfc");
  });

  it("keeps the fingerprint where it was for every row it does rename", () => {
    const row = stored({
      merchant: "Kfc",
      description: "KFC Wagga Wagga, NSW Purchase",
      source: sourceFromPairs([["Lines", "8:37pm KFC\nWagga Wagga, NSW Purchase"]]),
    });
    const upgraded = upgradeTransaction(row);
    assert.notEqual(upgraded.merchant, row.merchant);
    assert.equal(fingerprintOf(upgraded), fingerprintOf(row as never));
  });
});

describe("whether a stored row still needs writing", () => {
  it("asks for a write when the name can be improved", () => {
    const row = stored({
      merchant: "Kfc",
      description: "KFC Wagga Wagga, NSW Purchase",
      source: sourceFromPairs([["Lines", "8:37pm KFC\nWagga Wagga, NSW Purchase"]]),
    });
    assert.equal(storedInCurrentModel(row), false);
  });

  it("asks for none once the name is already the printed one", () => {
    const row = stored({
      merchant: "KFC",
      decidedBy: "rules",
      tags: ["Restaurants"],
      description: "KFC Wagga Wagga, NSW Purchase",
      source: sourceFromPairs([["Lines", "8:37pm KFC\nWagga Wagga, NSW Purchase"]]),
    });
    assert.equal(storedInCurrentModel(row), true);
  });
});
