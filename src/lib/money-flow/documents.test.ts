import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentLabel,
  filterByDocument,
  parseDocumentScope,
  parseDocumentView,
  sourceFilesFrom,
  totalsByDocument,
} from "./documents";
import { summarizeMoneyFlow } from "./summary";
import type { FileInterpretation, InterpretedTransaction } from "./types";

function txn(sourceFile: string, amount: number, id: string): InterpretedTransaction {
  return {
    id,
    merchant: "Cafe",
    category: "Dining",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type: amount > 0 ? "income" : "expense",
    sourceFile,
    confidence: 1,
  };
}

const everyday: FileInterpretation = {
  filename: "nab-medicare.csv",
  fileType: "csv",
  kind: "csv",
  uploadStatus: "uploaded",
  processingStatus: "completed",
  transactionCount: 2,
  notes: [],
};

const rent: FileInterpretation = {
  filename: "nab-rent.csv",
  fileType: "csv",
  kind: "csv",
  uploadStatus: "uploaded",
  processingStatus: "completed",
  transactionCount: 1,
  notes: [],
};

describe("document totals", () => {
  it("lists source files in first-seen order", () => {
    assert.deepEqual(
      sourceFilesFrom([txn("nab-medicare.csv", 10, "a"), txn("nab-rent.csv", -4, "b"), txn("nab-medicare.csv", 2, "c")]),
      ["nab-medicare.csv", "nab-rent.csv"],
    );
  });

  it("filters one document and keeps the combined total on all", () => {
    const rows = [txn("nab-medicare.csv", 100, "a"), txn("nab-rent.csv", -40, "b"), txn("nab-medicare.csv", 20, "c")];
    const medicare = filterByDocument(rows, { kind: "file", sourceFile: "nab-medicare.csv" });
    assert.equal(summarizeMoneyFlow(medicare).cashIn, 120);
    assert.equal(summarizeMoneyFlow(filterByDocument(rows, { kind: "all" })).cashNet, 80);
  });

  it("summarises each uploaded document on its own", () => {
    const rows = [txn("nab-medicare.csv", 164344.9, "a"), txn("nab-rent.csv", -3119.58, "b")];
    const totals = totalsByDocument([everyday, rent], rows);
    assert.equal(totals.length, 2);
    assert.equal(totals[0]?.label, "nab-medicare.csv");
    assert.equal(totals[0]?.flow.cashIn, 164344.9);
    assert.equal(totals[1]?.flow.cashOut, 3119.58);
    assert.equal(documentLabel("statement.xlsx · Offset"), "Offset");
  });

  it("parses stored together/separate choices", () => {
    assert.equal(parseDocumentView("separate"), "separate");
    assert.equal(parseDocumentView("together"), "together");
    assert.deepEqual(parseDocumentScope({ kind: "file", sourceFile: "nab-rent.csv" }, ["nab-medicare.csv", "nab-rent.csv"]), {
      kind: "file",
      sourceFile: "nab-rent.csv",
    });
    assert.deepEqual(parseDocumentScope({ kind: "file", sourceFile: "gone.csv" }, ["nab-rent.csv"]), { kind: "all" });
  });
});

describe("NAB documents on the dashboard", () => {
  it("keeps combined cash flow and per-file cash flow", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { interpretDocuments } = await import("./interpret");
    const samples = path.join(process.cwd(), "public/samples");
    const names = ["nab-medicare.csv", "nab-rent.csv"];
    const result = await interpretDocuments(
      names.map((filename) => ({
        filename,
        mime: "text/csv",
        bytes: new Uint8Array(readFileSync(path.join(samples, filename))),
      })),
    );
    const together = summarizeMoneyFlow(result.transactions);
    const separate = totalsByDocument(result.files, result.transactions);
    assert.equal(together.cashIn, 204214.49);
    assert.equal(together.cashOut, 203665.05);
    assert.equal(together.cashNet, 549.44);
    assert.equal(separate.length, 2);
    assert.equal(separate[0]?.flow.cashIn, 164344.9);
    assert.equal(separate[0]?.flow.cashOut, 160675.88);
    assert.equal(separate[0]?.flow.cashNet, 3669.02);
    assert.equal(separate[1]?.flow.cashIn, 39869.59);
    assert.equal(separate[1]?.flow.cashOut, 42989.17);
    assert.equal(separate[1]?.flow.cashNet, -3119.58);
  });
});
