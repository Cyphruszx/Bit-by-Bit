import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEV_TABLE_AFTER_SOURCE,
  DEV_TABLE_BANK,
  DEV_TABLE_BEFORE_BANK,
  DEV_TABLE_ID,
  DEV_TABLE_LABEL,
  EMPTY_CELL,
  blankCell,
  devTableCell,
  devTableColumns,
  directionAmount,
  sourceColumnKeys,
} from "./dev-table";
import { sourceFromPairs } from "./source";
import type { InterpretedTransaction } from "./types";
import type { ReviewItem } from "./review-queue";

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "row-1",
    merchant: "Woolworths",
    categoryKey: "groceries",
    date: "14 Sep 2026",
    dateIso: "2026-09-14",
    amount: -54.2,
    baseAmount: -54.2,
    type: "SPENDING",
    status: "CLEARED",
    sourceFile: "nab.csv",
    confidence: 0.91,
    extractedBy: "parser",
    decidedBy: "rules",
    description: "WOOLWORTHS 3120",
    accountId: "acct:nab-everyday",
    accountKey: "82-000 · 1234",
    institution: "NAB",
    tags: ["weekly"],
    bank: { category: "Food", type: "EFTPOS", merchant: "WOOLWORTHS" },
    source: sourceFromPairs([
      ["Date", "14 Sep 2026"],
      ["Amount", "-54.20"],
      ["Merchant Name", "WOOLWORTHS"],
    ]),
    ...over,
  };
}

describe("Dev mode raw-ledger columns", () => {
  it("names the preset and keeps Core out of the raw key list", () => {
    assert.equal(DEV_TABLE_ID, "dev");
    assert.equal(DEV_TABLE_LABEL, "Dev mode (raw ledger)");
    const keys = devTableColumns();
    assert.equal(keys.includes("Date"), false);
    assert.equal(keys.includes("Group"), false);
    assert.equal(keys.includes("Category"), false);
  });

  it("orders the full column set dateIso → … → bank.* → source.* → tags → rq_* → ids/meta", () => {
    const rows = [txn(), txn({ id: "row-2", source: sourceFromPairs([["Balance", "12.00"]]) })];
    const keys = devTableColumns(rows);
    const expected = [
      ...DEV_TABLE_BEFORE_BANK,
      ...DEV_TABLE_BANK,
      "source.Date",
      "source.Amount",
      "source.Merchant Name",
      "source.Balance",
      ...DEV_TABLE_AFTER_SOURCE,
    ];
    assert.deepEqual(keys, expected);
    assert.deepEqual(keys.slice(0, 6), [
      "dateIso",
      "direction/amount",
      "baseAmount",
      "movement_kind",
      "status",
      "merchant",
    ]);
    const bankAt = keys.indexOf("bank.category");
    const sourceAt = keys.indexOf("source.Date");
    const tagsAt = keys.indexOf("tags");
    const rqAt = keys.indexOf("rq_reason");
    const idAt = keys.indexOf("id");
    assert.ok(bankAt < sourceAt);
    assert.ok(sourceAt < tagsAt);
    assert.ok(tagsAt < rqAt);
    assert.ok(rqAt < idAt);
    assert.deepEqual(sourceColumnKeys(rows), [
      "source.Date",
      "source.Amount",
      "source.Merchant Name",
      "source.Balance",
    ]);
  });

  it("wires cells to InterpretedTransaction / LedgerEntry / Review Queue fields", () => {
    const row = txn({
      transferPair: "a~b",
      refundPair: "pay~ref",
      userFlaggedSavings: false,
      verdict: { counts: false, because: "own-account", at: "2026-09-14T00:00:00.000Z" },
    });
    const review: ReviewItem[] = [
      {
        id: "UNREVIEWED_KIND:woolworths",
        reason: "UNREVIEWED_KIND",
        state: "OPEN",
        movementIds: [row.id],
        label: "Woolworths needs a category",
      },
    ];
    const meta = {
      fingerprint: "acct:nab-everyday|2026-09-14|-54.20|abc|0",
      importIds: ["imp-1"],
      firstSeen: "2026-09-15T01:00:00.000Z",
    };
    const ctx = { meta, review };

    assert.equal(devTableCell(row, "dateIso", ctx), "2026-09-14");
    assert.equal(devTableCell(row, "direction/amount", ctx), "OUT -54.2");
    assert.equal(devTableCell(row, "baseAmount", ctx), "-54.2");
    assert.equal(devTableCell(row, "movement_kind", ctx), "SPENDING");
    assert.equal(devTableCell(row, "status", ctx), "CLEARED");
    assert.equal(devTableCell(row, "merchant", ctx), "Woolworths");
    assert.equal(devTableCell(row, "description", ctx), "WOOLWORTHS 3120");
    assert.equal(devTableCell(row, "categoryKey", ctx), "groceries");
    assert.equal(devTableCell(row, "accountId", ctx), "acct:nab-everyday");
    assert.equal(devTableCell(row, "institution", ctx), "NAB");
    assert.equal(devTableCell(row, "fingerprint", ctx), meta.fingerprint);
    assert.equal(devTableCell(row, "transferPair", ctx), "a~b");
    assert.equal(devTableCell(row, "refundPair", ctx), "pay~ref");
    assert.equal(devTableCell(row, "duplicate_of_id", ctx), EMPTY_CELL);
    assert.equal(devTableCell(row, "decidedBy", ctx), "rules");
    assert.equal(devTableCell(row, "user_overridden", ctx), "false");
    assert.equal(devTableCell(row, "confidence", ctx), "0.91");
    assert.equal(devTableCell(row, "extractedBy", ctx), "parser");
    assert.equal(devTableCell(row, "sourceFile", ctx), "nab.csv");
    assert.equal(devTableCell(row, "bank.category", ctx), "Food");
    assert.equal(devTableCell(row, "bank.type", ctx), "EFTPOS");
    assert.equal(devTableCell(row, "bank.merchant", ctx), "WOOLWORTHS");
    assert.equal(devTableCell(row, "source.Amount", ctx), "-54.20");
    assert.equal(devTableCell(row, "tags", ctx), "weekly");
    assert.equal(devTableCell(row, "rq_reason", ctx), "UNREVIEWED_KIND");
    assert.equal(devTableCell(row, "rq_state", ctx), "OPEN");
    assert.equal(devTableCell(row, "rq_id", ctx), "UNREVIEWED_KIND:woolworths");
    assert.equal(devTableCell(row, "id", ctx), "row-1");
    assert.equal(devTableCell(row, "importIds", ctx), "imp-1");
    assert.equal(devTableCell(row, "firstSeen", ctx), "2026-09-15T01:00:00.000Z");
    assert.equal(devTableCell(row, "accountKey", ctx), "82-000 · 1234");
    assert.equal(devTableCell(row, "verdict", ctx), "own-account");
    assert.equal(devTableCell(row, "userFlaggedSavings", ctx), "false");
  });

  it("shows — for fields the ledger has not populated yet", () => {
    const row = txn({
      description: undefined,
      accountId: undefined,
      institution: undefined,
      transferPair: undefined,
      refundPair: undefined,
      decidedBy: undefined,
      extractedBy: undefined,
      tags: undefined,
      bank: undefined,
      source: undefined,
      verdict: undefined,
      userFlaggedSavings: undefined,
    });
    assert.equal(devTableCell(row, "description"), EMPTY_CELL);
    assert.equal(devTableCell(row, "accountId"), EMPTY_CELL);
    assert.equal(devTableCell(row, "fingerprint"), EMPTY_CELL);
    assert.equal(devTableCell(row, "duplicate_of_id"), EMPTY_CELL);
    assert.equal(devTableCell(row, "extractedBy"), EMPTY_CELL);
    assert.equal(devTableCell(row, "bank.category"), EMPTY_CELL);
    assert.equal(devTableCell(row, "source.Date"), EMPTY_CELL);
    assert.equal(devTableCell(row, "tags"), EMPTY_CELL);
    assert.equal(devTableCell(row, "rq_reason"), EMPTY_CELL);
    assert.equal(devTableCell(row, "importIds"), EMPTY_CELL);
    assert.equal(devTableCell(row, "verdict"), EMPTY_CELL);
    assert.equal(devTableCell(row, "userFlaggedSavings"), EMPTY_CELL);
    assert.equal(blankCell(""), EMPTY_CELL);
    assert.equal(directionAmount(12.5), "IN 12.5");
    assert.equal(devTableCell(txn({ decidedBy: "user_overridden" }), "user_overridden"), "true");
    assert.equal(devTableCell(txn({ type: "earned" }), "movement_kind"), "INCOME");
  });
});
