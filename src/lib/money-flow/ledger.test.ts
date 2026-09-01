import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { interpretDocuments } from "./interpret";
import {
  appendToLedger,
  EMPTY_LEDGER,
  fingerprintOf,
  ledgerTransactions,
  parseLedger,
  removeImport,
} from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import type { FileInterpretation, InterpretedTransaction } from "./types";

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "a",
    merchant: "Cafe",
    category: "Dining",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -5,
    type: "expense",
    sourceFile: "statement.csv",
    confidence: 1,
    ...overrides,
  };
}

function file(filename: string): FileInterpretation {
  return {
    filename,
    fileType: "csv",
    kind: "csv",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    transactionCount: 0,
    notes: [],
  };
}

function upload(transactions: InterpretedTransaction[]) {
  const names = [...new Set(transactions.map((row) => row.sourceFile))];
  return { files: names.map(file), transactions };
}

const samples = path.join(process.cwd(), "public/samples");

async function readSamples(names: string[]) {
  return interpretDocuments(
    names.map((filename) => ({
      filename,
      mime: "text/csv",
      bytes: new Uint8Array(readFileSync(path.join(samples, filename))),
    })),
    { ai: null },
  );
}

describe("movement fingerprints", () => {
  it("identifies a movement by account, date, amount and wording, not by filename", () => {
    const june = txn({ accountKey: "100200300", description: "Coffee Roasters 123" });
    assert.equal(
      fingerprintOf(june),
      fingerprintOf({ ...june, sourceFile: "renamed-export.csv", id: "different" }),
    );
  });

  it("keeps two accounts apart even when the movements look identical", () => {
    const everyday = txn({ accountKey: "100200300", description: "Account fee" });
    const offset = txn({ accountKey: "400500600", description: "Account fee" });
    assert.notEqual(fingerprintOf(everyday), fingerprintOf(offset));
  });

  it("falls back to the file when the export never names an account", () => {
    assert.equal(fingerprintOf(txn({ sourceFile: "one.csv" })).startsWith("file:one.csv"), true);
  });
});

describe("accumulating a ledger", () => {
  it("adds the movements from a first import", () => {
    const { ledger, report } = appendToLedger(EMPTY_LEDGER, upload([txn(), txn({ id: "b", amount: -9 })]), {
      importedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(ledger.entries.length, 2);
    assert.equal(report.added, 2);
    assert.equal(report.duplicates, 0);
    assert.equal(report.imports[0]?.rows, 2);
  });

  it("keeps genuine same-day repeats of the same purchase", () => {
    const coffee = txn({ description: "Coffee Roasters" });
    const { ledger, report } = appendToLedger(EMPTY_LEDGER, upload([coffee, { ...coffee, id: "b" }]), {
      importedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(ledger.entries.length, 2);
    assert.equal(report.duplicates, 0);
  });

  it("recognises the same statement uploaded twice", () => {
    const rows = [txn({ accountKey: "100200300" }), txn({ id: "b", amount: -9, accountKey: "100200300" })];
    const first = appendToLedger(EMPTY_LEDGER, upload(rows), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload(rows), { importedAt: "2026-09-02T00:00:00.000Z" });
    assert.equal(second.ledger.entries.length, 2);
    assert.equal(second.report.added, 0);
    assert.equal(second.report.duplicates, 2);
  });

  it("recognises the same file content under a new name", () => {
    const rows = [txn(), txn({ id: "b", amount: -9 })];
    const renamed = rows.map((row) => ({ ...row, sourceFile: "copy.csv" }));
    const first = appendToLedger(EMPTY_LEDGER, upload(rows), {
      importedAt: "2026-09-01T00:00:00.000Z",
      hashes: { "statement.csv": "hash-1" },
    });
    const second = appendToLedger(first.ledger, upload(renamed), {
      importedAt: "2026-09-02T00:00:00.000Z",
      hashes: { "copy.csv": "hash-1" },
    });
    assert.equal(second.ledger.entries.length, 2);
    assert.equal(second.report.added, 0);
    assert.equal(second.report.imports[0]?.repeatOf, first.report.imports[0]?.id);
  });

  it("adds only what is new when two statements overlap", () => {
    const july = txn({ accountKey: "100200300", dateIso: "2026-07-01", description: "Rent" });
    const august = txn({ id: "b", accountKey: "100200300", dateIso: "2026-08-01", description: "Rent" });
    const september = txn({ id: "c", accountKey: "100200300", dateIso: "2026-09-01", description: "Rent" });
    const first = appendToLedger(EMPTY_LEDGER, upload([july, august]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload([august, september]), {
      importedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(second.ledger.entries.length, 3);
    assert.equal(second.report.added, 1);
    assert.equal(second.report.duplicates, 1);
  });

  it("keeps tags the user already set when a later statement repeats a movement", () => {
    const row = txn({ accountKey: "100200300" });
    const first = appendToLedger(EMPTY_LEDGER, upload([row]), { importedAt: "2026-09-01T00:00:00.000Z" });
    first.ledger.entries[0].tags = ["Groceries"];
    const second = appendToLedger(first.ledger, upload([row]), { importedAt: "2026-09-02T00:00:00.000Z" });
    assert.deepEqual(second.ledger.entries[0]?.tags, ["Groceries"]);
  });

  it("removes an import without dropping movements a later import also covers", () => {
    const shared = txn({ accountKey: "100200300" });
    const only = txn({ id: "b", amount: -9, accountKey: "100200300" });
    const first = appendToLedger(EMPTY_LEDGER, upload([shared, only]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload([shared]), { importedAt: "2026-09-02T00:00:00.000Z" });

    const withoutFirst = removeImport(second.ledger, first.report.imports[0].id);
    assert.equal(withoutFirst.entries.length, 1);
    assert.equal(withoutFirst.entries[0]?.amount, -5);
    assert.equal(withoutFirst.imports.length, 1);
  });

  it("reads back a stored ledger and rejects junk", () => {
    const { ledger } = appendToLedger(EMPTY_LEDGER, upload([txn()]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));
    assert.equal(restored?.entries.length, 1);
    assert.equal(parseLedger({ entries: "no" }), null);
    assert.equal(parseLedger(null), null);
  });
});

describe("accumulating the NAB statements", () => {
  it("reads both accounts once, however many times they are uploaded", async () => {
    const first = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const once = appendToLedger(EMPTY_LEDGER, first, { importedAt: "2026-09-01T00:00:00.000Z" });
    const before = summarizeMoneyFlow(ledgerTransactions(once.ledger));

    assert.equal(once.report.added, 437);
    assert.equal(before.cashIn, 204214.49);
    assert.equal(before.cashOut, 203665.05);
    assert.equal(before.cashNet, 549.44);

    const again = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const twice = appendToLedger(once.ledger, again, { importedAt: "2026-09-02T00:00:00.000Z" });
    const after = summarizeMoneyFlow(ledgerTransactions(twice.ledger));

    assert.equal(twice.report.added, 0);
    assert.equal(twice.report.duplicates, 437);
    assert.equal(twice.ledger.entries.length, 437);
    assert.equal(after.cashIn, before.cashIn);
    assert.equal(after.cashOut, before.cashOut);
    assert.equal(after.cashNet, before.cashNet);
  });

  it("builds up one account at a time", async () => {
    const rent = await readSamples(["nab-rent.csv"]);
    const step = appendToLedger(EMPTY_LEDGER, rent, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.equal(summarizeMoneyFlow(ledgerTransactions(step.ledger)).cashNet, -3119.58);

    const both = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const full = appendToLedger(step.ledger, both, { importedAt: "2026-09-02T00:00:00.000Z" });
    const flow = summarizeMoneyFlow(ledgerTransactions(full.ledger));

    assert.equal(full.report.added, 378);
    assert.equal(full.report.duplicates, 59);
    assert.equal(flow.cashIn, 204214.49);
    assert.equal(flow.cashOut, 203665.05);
    assert.equal(flow.cashNet, 549.44);
  });

  it("names the account each import covered", async () => {
    const result = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const { report } = appendToLedger(EMPTY_LEDGER, result, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.deepEqual(report.imports.map((entry) => entry.accountKeys), [["acct:100200300"], ["acct:400500600"]]);
    assert.equal(report.imports[0]?.from, "2025-07-01");
  });
});
