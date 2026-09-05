import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allTags,
  categorizeMerchant,
  categoryOf,
  merchantRows,
  removeTag,
  renameTag,
  sameMerchant,
  tagMerchant,
  tagsOf,
  tidyTag,
  withCategory,
  withTags,
} from "./tags";
import type { InterpretedTransaction } from "./types";

function txn(categoryKey: string, tags?: string[]): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Woolworths",
    categoryKey,
    ...(tags ? { tags } : {}),
    date: "25 Aug",
    dateIso: "2026-08-25",
    amount: -86.4,
    type: "spent",
    sourceFile: "demo",
    confidence: 1,
  };
}

describe("transaction tags", () => {
  it("keeps the two axes apart, so a tag can never move a total", () => {
    const row = withTags(txn("food"), ["Weekly"]);
    assert.equal(categoryOf(row), "food");
    assert.deepEqual(tagsOf(row), ["Weekly"]);
    // The old model wrote the first tag back into the category, so these were one field
    // and adding a tag silently re-filed the movement.
    assert.equal(withTags(row, ["Payday"]).categoryKey, "food");
    assert.equal(tidyTag("  eating out "), "Eating Out");
  });

  it("takes as many tags as a person wants, and each of them once", () => {
    const next = withTags(txn("food"), ["food", "Woolworths", "food"]);
    assert.deepEqual(next.tags, ["Food", "Woolworths"]);
  });

  it("treats a category a person chose as settled", () => {
    const next = withCategory(txn("uncategorised"), "food");
    assert.equal(next.categoryKey, "food");
    assert.equal(next.decidedBy, "said");
  });

  it("refuses a category the taxonomy has never heard of", () => {
    // Otherwise a typo becomes a category, and every report grows a column nobody meant.
    assert.equal(withCategory(txn("food"), "not-a-real-key").categoryKey, "uncategorised");
  });

  it("renames and removes a tag across the list", () => {
    const rows = [txn("food", ["Weekend"]), txn("leisure", ["Weekend", "Shared"])];
    const renamed = renameTag(rows, "weekend", "long weekend");
    assert.deepEqual(allTags(renamed), ["Long Weekend", "Shared"]);
    const removed = removeTag(renamed, "long weekend");
    assert.deepEqual(tagsOf(removed[1]), ["Shared"]);
    // Losing the last tag leaves no tags, not a placeholder one.
    assert.deepEqual(tagsOf(removed[0]), []);
    assert.equal(removed[0].categoryKey, "food", "a tag edit never touches the category");
  });
});

describe("applying a change to every movement of a merchant", () => {
  function row(id: string, merchant: string, tags?: string[]): InterpretedTransaction {
    return { ...txn("food", tags), id, merchant };
  }

  const rows = [
    row("1", "Woolworths"),
    row("2", "WOOLWORTHS"),
    row("3", "Coles"),
    row("4", "woolworths "),
  ];

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
      assert.equal(changed?.decidedBy, "said");
    }
    const untouched = next.find((r) => r.id === "3");
    assert.equal(untouched?.categoryKey, "food");
    assert.equal(untouched, rows[2], "an unrelated row should not be rebuilt");
  });

  it("tags that merchant and nothing else", () => {
    const next = tagMerchant(rows, "Coles", ["Weekly Shop"]);
    assert.deepEqual(next.find((r) => r.id === "3")?.tags, ["Weekly Shop"]);
    assert.equal(next.find((r) => r.id === "1")?.tags, undefined);
  });

  it("leaves the list alone when no movement carries that merchant", () => {
    assert.deepEqual(categorizeMerchant(rows, "Aldi", "food"), rows);
    assert.equal(merchantRows(rows, "Aldi").length, 0);
  });
});
