import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretMovement } from "./interpret-row";
import { tableInterpretationNotes, tagFromBankCategory } from "./statement-category";

describe("statement category mapping", () => {
  it("maps NAB labels onto BitbyBit tags", () => {
    assert.equal(tagFromBankCategory("Groceries", -12.8), "Groceries");
    assert.equal(tagFromBankCategory("Fuel", -76.12), "Transport");
    assert.equal(tagFromBankCategory("Restaurants & takeaway", -28.8), "Dining");
    assert.equal(tagFromBankCategory("Medical", -376), "Health");
    assert.equal(tagFromBankCategory("Government payments", 41.45), "Income");
    assert.equal(tagFromBankCategory("Transfers out", -200), "Goals");
    assert.equal(tagFromBankCategory("Internal transfers", 1), "Goals");
    assert.equal(tagFromBankCategory("Uncategorised", -24800), "Other");
    assert.equal(tagFromBankCategory("Interest", 0.1), "Income");
    assert.equal(tagFromBankCategory("Interest", -0.61), "Other");
  });

  it("recognises a NAB header row", () => {
    const notes = tableInterpretationNotes([
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
    ]);
    assert.match(notes[0] ?? "", /NAB account export/);
  });
});

describe("movement interpretation", () => {
  it("keeps a statement-supplied sign and fills the tag from the bank category", () => {
    const txn = interpretMovement({
      dateIso: "2026-06-01",
      amount: -15.4,
      directionKnown: true,
      description: "XYZ MART 999",
      typeHint: "EFTPOS DEBIT",
      bankCategory: "Groceries",
      sourceFile: "nab.csv",
      id: "1",
      confidence: 0.92,
    });
    assert.equal(txn.amount, -15.4);
    assert.equal(txn.type, "expense");
    assert.equal(txn.category, "Groceries");
    assert.deepEqual(txn.tags, ["Groceries"]);
  });

  it("prefers a known merchant rule over a generic bank category", () => {
    const txn = interpretMovement({
      dateIso: "2026-06-29",
      amount: 662.4,
      directionKnown: true,
      description: "Mc Bbs747 5550001x Mcare Benefits",
      typeHint: "INTER-BANK CREDIT",
      merchant: "Medicare",
      bankCategory: "Government payments",
      sourceFile: "nab.csv",
      id: "2",
      confidence: 0.92,
    });
    assert.equal(txn.merchant, "Medicare");
    assert.equal(txn.category, "Health");
    assert.equal(txn.type, "income");
    assert.equal(txn.amount, 662.4);
  });

  it("does not flip an incoming transfer negative", () => {
    const txn = interpretMovement({
      dateIso: "2026-06-30",
      amount: 25000,
      directionKnown: true,
      description: "SocietyOne",
      typeHint: "TRANSFER CREDIT",
      bankCategory: "Transfers in",
      sourceFile: "nab.csv",
      id: "3",
      confidence: 0.92,
    });
    assert.equal(txn.amount, 25000);
    assert.equal(txn.type, "transfer");
    assert.equal(txn.category, "Goals");
  });
});
