import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectInstitution,
  institutionForStatement,
  institutionKey,
  institutionOf,
  UNKNOWN_INSTITUTION,
  withInstitution,
} from "./institution";
import type { InterpretedTransaction } from "./types";

function txn(sourceFile: string, institution?: string): InterpretedTransaction {
  return {
    id: `${sourceFile}-1`,
    merchant: "Cafe",
    categoryKey: "food",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -4.5,
    type: "spent",
    sourceFile,
    confidence: 1,
    ...(institution ? { institution } : {}),
  };
}

const NAB_HEADERS = [
  "Date",
  "Amount",
  "Account Number",
  "",
  "Transaction Type",
  "Transaction Details",
  "Balance",
  "Category",
  "Merchant Name",
  "Processed On",
];

describe("institution detection", () => {
  it("reads the wording an Up statement prints on itself", () => {
    assert.equal(
      detectInstitution({ text: "Up is a brand of Bendigo and Adelaide Bank", filename: "statement.pdf" }),
      "Up",
    );
  });

  it("recognises a NAB export by the columns only NAB produces", () => {
    assert.equal(detectInstitution({ headers: NAB_HEADERS, filename: "export.csv" }), "NAB");
  });

  it("takes the bank an OFX file names for itself", () => {
    assert.equal(detectInstitution({ org: "Westpac Banking Corporation" }), "Westpac");
  });

  it("keeps an unfamiliar bank's own name rather than dropping it", () => {
    assert.equal(detectInstitution({ org: "Great Southern Credit Union" }), "Great Southern Credit Union");
  });

  it("falls back to a bank named in the filename", () => {
    assert.equal(detectInstitution({ filename: "commonwealth-bank.csv" }), "Commonwealth Bank");
    assert.equal(detectInstitution({ filename: "up-2025-07-to-2026-06.txt" }), "Up");
  });

  it("statement wording beats a filename that says otherwise", () => {
    assert.equal(detectInstitution({ text: "Zap card **1234", filename: "anz-export.txt" }), "Up");
  });

  it("names nothing when nothing in the file says which bank it is", () => {
    assert.equal(detectInstitution({ text: "1 Jun Cafe -4.50", filename: "statement.csv" }), undefined);
    assert.equal(detectInstitution({ filename: "backup-of-my-savings.csv" }), undefined);
  });
});

describe("naming a statement's institution", () => {
  it("stamps every movement a document produced", () => {
    const stamped = withInstitution([txn("a.csv"), txn("a.csv")], "NAB");
    assert.deepEqual(
      stamped.map((row) => row.institution),
      ["NAB", "NAB"],
    );
  });

  it("leaves movements alone when the bank is unknown", () => {
    assert.equal(withInstitution([txn("a.csv")], undefined)[0].institution, undefined);
  });

  it("prefers the name a person gave over the one that was read", () => {
    assert.equal(institutionOf(txn("a.csv", "NAB"), { "a.csv": "Great Southern" }), "Great Southern");
  });

  it("says unknown rather than guessing", () => {
    assert.equal(institutionOf(txn("a.csv")), UNKNOWN_INSTITUTION);
  });

  it("still answers for a statement whose movements have gone", () => {
    assert.equal(institutionForStatement("a.csv", [], { "a.csv": "NAB" }), "NAB");
    assert.equal(institutionForStatement("a.csv", []), UNKNOWN_INSTITUTION);
  });

  it("groups one bank spelled two ways", () => {
    assert.equal(institutionKey("NAB"), institutionKey(" nab "));
  });
});
