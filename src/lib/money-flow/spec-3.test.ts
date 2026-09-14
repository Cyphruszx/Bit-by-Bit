/**
 * Slice 5: Spec 3 movement_kind and authority.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, outranks } from "./classify";
import { interpretMovement } from "./interpret-row";
import {
  appendToLedger,
  EMPTY_LEDGER,
  fingerprintOf,
  legacyFingerprintOf,
} from "./ledger";
import {
  authorityOf,
  isUserOverridden,
  kindOf,
  migrateStoredType,
} from "./movement-kind";
import { looksLikeCreditCardRepayment } from "./statement-category";
import { typeForCategory } from "./taxonomy";
import { confirmTransferPair } from "./review-queue";
import type { FileInterpretation, InterpretedTransaction } from "./types";
import { upgradeTransaction } from "./upgrade";

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: over.id ?? "a",
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? "groceries",
    date: "1 Jun",
    dateIso: over.dateIso ?? "2026-06-01",
    amount: over.amount ?? -5,
    type: over.type ?? "SPENDING",
    sourceFile: over.sourceFile ?? "statement.csv",
    confidence: 1,
    ...over,
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

describe("Spec 3 movement_kind", () => {
  it("maps stored earned/spent/moved/returned/borrowed onto the Spec 3 set", () => {
    assert.equal(migrateStoredType("earned"), "INCOME");
    assert.equal(migrateStoredType("spent"), "SPENDING");
    assert.equal(migrateStoredType("moved"), "TRANSFER");
    assert.equal(migrateStoredType("returned"), "REFUND");
    assert.equal(migrateStoredType("borrowed"), "DEBT_PRINCIPAL");
    assert.equal(migrateStoredType("repaid"), "DEBT_PRINCIPAL");
    assert.equal(migrateStoredType("invested"), "INVESTMENT");
    assert.equal(migrateStoredType("adjusted"), "ADJUSTMENT");
    assert.equal(kindOf("INCOME"), "INCOME");
  });

  it("derives UNREVIEWED for unsorted rows and INCOME/SPENDING/DEBT from categories", () => {
    assert.equal(typeForCategory("uncategorised", -12), "UNREVIEWED");
    assert.equal(typeForCategory("uncategorised", 12), "UNREVIEWED");
    assert.equal(typeForCategory("groceries", -12), "SPENDING");
    assert.equal(typeForCategory("salary", 12), "INCOME");
    assert.equal(typeForCategory("debt-payments", 25000), "DEBT_PRINCIPAL");
    assert.equal(typeForCategory("debt-payments", -400), "DEBT_PRINCIPAL");
    assert.equal(typeForCategory("invest", -100), "INVESTMENT");
  });

  it("reads a stored earned row as INCOME without dropping it", () => {
    const upgraded = upgradeTransaction(
      txn({ type: "earned", categoryKey: "salary", amount: 100, decidedBy: "said" }),
    );
    assert.equal(upgraded.type, "INCOME");
    assert.equal(upgraded.decidedBy, "user_overridden");
  });
});

describe("Spec 3 authority", () => {
  it("treats said as user_overridden and learned as user_rule", () => {
    assert.equal(authorityOf("said"), "user_overridden");
    assert.equal(authorityOf("user_overridden"), "user_overridden");
    assert.equal(authorityOf("learned"), "user_rule");
    assert.equal(authorityOf("user_rule"), "user_rule");
    assert.equal(authorityOf("rules"), "core");
    assert.equal(authorityOf("unreviewed"), "unreviewed");
  });

  it("never lets Core or a merchant rule overwrite a row the person settled", () => {
    assert.ok(outranks("user_overridden", "user_rule"));
    assert.ok(outranks("user_rule", "rules"));
    assert.ok(!outranks("rules", "user_overridden"));
    assert.ok(!outranks("user_rule", "said"));
    assert.ok(isUserOverridden(txn({ decidedBy: "said" })));
  });

  it("Spec 7 RESOLVE writes user_overridden TRANSFER", () => {
    const rows = confirmTransferPair(
      [
        txn({ id: "out", amount: -40, type: "SPENDING" }),
        txn({ id: "in", amount: 40, type: "INCOME" }),
      ],
      "out",
      "in",
    );
    assert.equal(rows[0]?.type, "TRANSFER");
    assert.equal(rows[0]?.decidedBy, "user_overridden");
  });
});

describe("Spec 3 fingerprint", () => {
  it("uses a hash of the raw description, not the wording itself", () => {
    const row = txn({ description: "Coffee Roasters 123", accountKey: "100200300" });
    const fp = fingerprintOf(row);
    assert.match(fp, /\|[0-9a-f]{8}\|0$/);
    assert.ok(!fp.includes("coffee roasters"));
    assert.equal(fp, fingerprintOf({ ...row, sourceFile: "other.csv", id: "b" }));
  });

  it("still matches a ledger stored under the old wording fingerprint", () => {
    const row = txn({ description: "Coffee Roasters 123", accountKey: "100200300" });
    const first = appendToLedger(
      {
        ...EMPTY_LEDGER,
        entries: [
          {
            ...row,
            fingerprint: legacyFingerprintOf(row),
            importIds: ["old"],
            firstSeen: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      { files: [file(row.sourceFile)], transactions: [row] },
      { importedAt: "2026-09-02T00:00:00.000Z" },
    );
    assert.equal(first.report.added, 0);
    assert.equal(first.report.duplicates, 1);
    assert.equal(first.ledger.entries[0]?.fingerprint, fingerprintOf(row));
  });

  it("lets user_overridden win on the same fingerprint at re-import", () => {
    const held = txn({
      accountKey: "100200300",
      description: "Rent",
      amount: -900,
      decidedBy: "rules",
      categoryKey: "uncategorised",
    });
    const first = appendToLedger(EMPTY_LEDGER, { files: [file("a.csv")], transactions: [held] }, {
      importedAt: "2026-09-01T00:00:00.000Z",
    });
    const incoming = {
      ...held,
      decidedBy: "user_overridden" as const,
      categoryKey: "rent-mortgage",
      type: "SPENDING" as const,
    };
    const second = appendToLedger(first.ledger, { files: [file("b.csv")], transactions: [incoming] }, {
      importedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(second.report.added, 0);
    assert.equal(second.ledger.entries[0]?.decidedBy, "user_overridden");
    assert.equal(second.ledger.entries[0]?.categoryKey, "rent-mortgage");
  });
});

describe("credit-card repayment from checking", () => {
  it("classifies as TRANSFER, not Spending, without writing a pair", () => {
    const row = interpretMovement({
      dateIso: "2026-06-01",
      amount: -200,
      directionKnown: true,
      description: "Visa Payment",
      merchant: "Visa Payment",
      accountId: "NAB · Everyday",
      sourceFile: "nab.csv",
      id: "cc",
      confidence: 0.9,
    });
    assert.equal(row.type, "TRANSFER");
    assert.equal(row.transferPair, undefined);
    assert.ok(looksLikeCreditCardRepayment(row));

    const classified = classify([row]);
    assert.equal(classified[0]?.type, "TRANSFER");
    assert.equal(classified[0]?.transferPair, undefined);
  });
});
