import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorizeMerchant, categoryOf, merchantRows, sameMerchant, withCategory } from "./category-of";
import type { InterpretedTransaction } from "./types";

function txn(categoryKey: string): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Woolworths",
    categoryKey,
    date: "25 Aug",
    dateIso: "2026-08-25",
    amount: -86.4,
    type: "spent",
    sourceFile: "demo",
    confidence: 1,
  };
}

describe("a movement's category", () => {
  it("reads the filing key, and only a key the taxonomy knows", () => {
    assert.equal(categoryOf(txn("groceries")), "groceries");
    assert.equal(categoryOf(txn("not-a-real-key")), "uncategorised");
  });

  it("treats a category a person chose as settled", () => {
    const next = withCategory(txn("uncategorised"), "groceries");
    assert.equal(next.categoryKey, "groceries");
    assert.equal(next.decidedBy, "user_overridden");
    assert.equal(next.type, "SPENDING");
  });

  it("lets the type follow the category, so the two cannot disagree", () => {
    assert.equal(withCategory(txn("groceries"), "salary").type, "ADJUSTMENT");
  });

  it("refuses a category the taxonomy has never heard of", () => {
    assert.equal(withCategory(txn("groceries"), "not-a-real-key").categoryKey, "uncategorised");
  });
});

describe("applying a category to every movement of a merchant", () => {
  function row(id: string, merchant: string): InterpretedTransaction {
    return { ...txn("groceries"), id, merchant };
  }

  const rows = [row("1", "Woolworths"), row("2", "WOOLWORTHS"), row("3", "Coles"), row("4", "woolworths ")];

  it("matches a merchant whatever case the statement used", () => {
    assert.ok(sameMerchant("Woolworths", "WOOLWORTHS"));
    assert.ok(sameMerchant("woolworths ", " Woolworths"));
    assert.ok(!sameMerchant("Woolworths", "Woolworths Metro"));
    assert.equal(merchantRows(rows, "woolworths").length, 3);
  });

  it("re-files that merchant and nothing else", () => {
    const next = categorizeMerchant(rows, "Woolworths", "shopping");
    for (const id of ["1", "2", "4"]) {
      const changed = next.find((r) => r.id === id);
      assert.equal(changed?.categoryKey, "shopping", `row ${id}`);
      assert.equal(changed?.decidedBy, "user_overridden");
    }
    const untouched = next.find((r) => r.id === "3");
    assert.equal(untouched?.categoryKey, "groceries");
    assert.equal(untouched, rows[2], "an unrelated row should not be rebuilt");
  });

  it("leaves the list alone when no movement carries that merchant", () => {
    assert.deepEqual(categorizeMerchant(rows, "Aldi", "groceries"), rows);
    assert.equal(merchantRows(rows, "Aldi").length, 0);
  });
});
