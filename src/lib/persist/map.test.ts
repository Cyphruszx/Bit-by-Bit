import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactAccountIdentifiers } from "./redact";
import { INTERPRETED_KEY, LOCAL_FINANCE_KEYS, wipeLocalFinanceKeys } from "./keys";
import { localHasImportableData, readLocalInterpreted } from "./local";
import { fileFromRow, neededCategoryNames, periodFromJson, transactionFromRow, transactionToRow } from "./map";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

describe("redactAccountIdentifiers", () => {
  it("masks PANs, BSBs, and labelled account numbers", () => {
    assert.match(redactAccountIdentifiers("Card 4111111111111111 at Coles"), /•{13,}/);
    assert.match(redactAccountIdentifiers("BSB 062-000"), /•/);
    assert.match(redactAccountIdentifiers("Account number 12345678"), /•/);
    assert.equal(redactAccountIdentifiers("Woolworths Bondi"), "Woolworths Bondi");
  });
});

describe("transaction mapping", () => {
  it("round-trips primary and sub-tags without storing originals that look like PANs", () => {
    const txn: InterpretedTransaction = {
      id: "csv-1",
      merchant: "Woolworths 4111111111111111",
      category: "Groceries",
      tags: ["Groceries", "Woolworths"],
      date: "25 Aug",
      dateIso: "2026-08-25",
      amount: -86.4,
      type: "expense",
      sourceFile: "cba.csv",
      confidence: 0.9,
      tagSource: "rules",
      extractedBy: "parser",
    };
    const row = transactionToRow(txn, "11111111-1111-4111-8111-111111111111", "cat", null);
    assert.equal(row.client_key, "csv-1");
    assert.doesNotMatch(row.merchant_name ?? "", /4111/);
    assert.deepEqual(row.tags.slice(0, 2), ["Groceries", "Woolworths"]);
    const back = transactionFromRow({
      id: "22222222-2222-4222-8222-222222222222",
      client_key: row.client_key,
      transaction_date: row.transaction_date,
      description: row.description,
      merchant_name: row.merchant_name,
      amount: row.amount,
      transaction_type: row.transaction_type,
      subcategory: row.subcategory,
      source_filename: row.source_filename,
      ai_confidence: row.ai_confidence,
      tags: row.tags ?? [],
      tag_source: row.tag_source,
      extracted_by: row.extracted_by,
      category_name: "Groceries",
    });
    assert.equal(back.id, "csv-1");
    assert.equal(back.category, "Groceries");
    assert.deepEqual(back.tags, ["Groceries", "Woolworths"]);
    assert.equal(neededCategoryNames([txn])[0], "Groceries");
  });

  it("restores file metadata without a storage path", () => {
    const file = fileFromRow({
      id: "33333333-3333-4333-8333-333333333333",
      filename: "cba.csv",
      file_type: "csv",
      file_kind: "csv",
      notes: ["Read as CSV"],
      transaction_count: 12,
      upload_status: "uploaded",
      processing_status: "completed",
      processing_error: null,
    });
    assert.equal(file.filename, "cba.csv");
    assert.equal(file.kind, "csv");
    assert.equal(periodFromJson({ kind: "month", month: "2026-08" }).kind, "month");
  });
});

describe("local import snapshot", () => {
  it("treats missing keys as nothing to import and wipes known finance keys", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    assert.equal(localHasImportableData(storage), false);
    store.set(INTERPRETED_KEY, JSON.stringify({ files: [], transactions: [{ id: "t1" }] }));
    assert.equal(readLocalInterpreted(storage).transactions[0]?.id, "t1");
    assert.equal(localHasImportableData(storage), true);
    wipeLocalFinanceKeys(storage);
    for (const key of LOCAL_FINANCE_KEYS) assert.equal(store.get(key), undefined);
  });
});
