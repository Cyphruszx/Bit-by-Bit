import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretMovement } from "./interpret-row";
import { describeSpan } from "./parse-values";
import { categoryFromBankLabel, looksInternal, tableInterpretationNotes } from "./statement-category";

describe("statement category mapping", () => {
  it("reads a NAB label as a hint, and answers with a real category", () => {
    assert.equal(categoryFromBankLabel("Groceries", -12.8), "food.groceries");
    assert.equal(categoryFromBankLabel("Fuel", -76.12), "transport.fuel");
    assert.equal(categoryFromBankLabel("Restaurants & takeaway", -28.8), "food.restaurants");
    assert.equal(categoryFromBankLabel("Medical", -376), "health.gp-specialist");
    assert.equal(categoryFromBankLabel("Government payments", 41.45), "income.government-benefit");
    // Interest both ways, from the one label. The old table sent the charge to Other.
    assert.equal(categoryFromBankLabel("Interest", 0.1), "income.interest");
    assert.equal(categoryFromBankLabel("Loans", -0.61), "money.interest-charged");
  });

  it("has no category for a label that says nothing, rather than a bucket", () => {
    // Null is not Other. A movement nothing recognised is waiting to be looked at, and
    // saying so separately is what keeps a genuine miss out of the pile a person chose.
    assert.equal(categoryFromBankLabel("Uncategorised", -24800), null);
    assert.equal(categoryFromBankLabel("Other", -12), null);
    assert.equal(categoryFromBankLabel(undefined, -12), null);
  });

  it("refuses to turn a transfer label into a category at all", () => {
    // These used to become "Goals", which counted a $200 payment to a person and a
    // $25,000 loan as the person's own money moving. Whether money went to another of
    // their accounts is settled by finding the other leg, never by a word.
    assert.equal(categoryFromBankLabel("Transfers out", -200), null);
    assert.equal(categoryFromBankLabel("Internal transfers", 1), null);
    assert.ok(looksInternal({ bank: { category: "Transfers out" }, merchant: "Jordan Lee" }));
    assert.ok(!looksInternal({ bank: { category: "Groceries" }, merchant: "Woolworths" }));
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
  it("keeps a statement-supplied sign and falls back to the bank's label", () => {
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
    assert.equal(txn.type, "spent");
    assert.equal(txn.categoryKey, "food");
    assert.equal(txn.decidedBy, "bank");
    // The bank's own words are kept beside the movement, never written over.
    assert.deepEqual(txn.bank, { category: "Groceries", type: "EFTPOS DEBIT" });
    // The detail the bank's label carried survives as a tag beside the category.
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
    assert.equal(txn.bank?.merchant, "Medicare");
    // A benefit arriving is not health spending. One rule recognises Medicare and the
    // direction decides which of the two it meant, which is the whole point of splitting
    // the category from the type.
    assert.equal(txn.categoryKey, "income");
    assert.equal(txn.type, "earned");
    assert.equal(txn.amount, 662.4);
  });

  it("reads the same merchant as health spending on the way out", () => {
    const txn = interpretMovement({
      dateIso: "2026-06-29",
      amount: -376,
      directionKnown: true,
      description: "MEDICARE EASYCLAIM GAP",
      sourceFile: "nab.csv",
      id: "2b",
      confidence: 0.92,
    });
    assert.equal(txn.categoryKey, "health");
    assert.equal(txn.type, "spent");
  });

  it("reads a lender's drawdown as borrowing, not as income", () => {
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
    // $25,000 from a consumer lender is not money earned and never was. Counting it
    // destroyed the month it landed in; the bank calling it a transfer did not help.
    assert.equal(txn.categoryKey, "debt");
    assert.equal(txn.type, "borrowed");
    assert.equal(txn.bank?.category, "Transfers in");
  });

  it("copies the source row through and does not let it rewrite the working columns", () => {
    const source = {
      headers: ["Date", "Amount", "Category", "Merchant Name"],
      values: ["30 Jun 26", "25000.00", "Transfers in", ""],
    };
    const txn = interpretMovement({
      dateIso: "2026-06-30",
      amount: 25000,
      directionKnown: true,
      description: "SocietyOne",
      typeHint: "TRANSFER CREDIT",
      bankCategory: "Transfers in",
      source,
      sourceFile: "nab.csv",
      id: "4",
      confidence: 0.92,
    });
    assert.deepEqual(txn.source, source);
    assert.equal(txn.categoryKey, "debt");
    assert.equal(txn.type, "borrowed");
    assert.equal(txn.amount, 25000);
  });
});

describe("saying when a run of movements happened", () => {
  it("always names the year, because a ledger holds several", () => {
    assert.equal(describeSpan("2026-06-30", "2026-06-30"), "30 June 2026");
  });

  it("says the year once when a span stays inside one", () => {
    assert.equal(describeSpan("2026-03-05", "2026-05-29"), "5 Mar – 29 May 2026");
  });

  it("says both when a span crosses new year, which would otherwise read backwards", () => {
    assert.equal(describeSpan("2025-07-01", "2026-06-29"), "1 July 2025 – 29 June 2026");
  });
});
