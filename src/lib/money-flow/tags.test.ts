import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allPrimaryTags, allSubTags, makePrimary, merchantRows, primaryTag, removeTag, renameTag, sameMerchant, subTags, tagMerchant, tagsOf, tidyTag, withPrimary, withTags } from "./tags";
import type { InterpretedTransaction } from "./types";

function txn(category: string, tags?: string[]): InterpretedTransaction {
  return {
    id: "1",
    merchant: "Woolworths",
    category,
    tags,
    date: "25 Aug",
    dateIso: "2026-08-25",
    amount: -86.4,
    type: "expense",
    sourceFile: "demo",
    confidence: 1,
  };
}

describe("transaction tags", () => {
  it("falls back to the interpreted category", () => {
    assert.deepEqual(tagsOf(txn("Groceries")), ["Groceries"]);
    assert.equal(tidyTag("  eating out "), "Eating Out");
  });

  it("lets a transaction keep several tags and uses the first as the primary label", () => {
    const next = withTags(txn("Groceries"), ["food", "Woolworths", "food"]);
    assert.deepEqual(next.tags, ["Food", "Woolworths"]);
    assert.equal(next.category, "Food");
    assert.equal(primaryTag(next), "Food");
    assert.deepEqual(subTags(next), ["Woolworths"]);
    assert.equal(next.tagSource, "user");
  });

  it("changes the primary without dropping the sub-tag", () => {
    const row = withTags(txn("Dining"), ["Dining", "Coffee"]);
    const next = withPrimary(row, "Take-Away");
    assert.equal(primaryTag(next), "Take-Away");
    assert.deepEqual(subTags(next), ["Coffee"]);
    const promoted = makePrimary(row, "Coffee");
    assert.equal(primaryTag(promoted), "Coffee");
    assert.deepEqual(subTags(promoted), ["Dining"]);
  });

  it("renames and removes a tag across the list", () => {
    const rows = [txn("Groceries"), txn("Dining", ["Dining", "Weekend"])];
    const renamed = renameTag(rows, "dining", "eating out");
    assert.deepEqual(allPrimaryTags(renamed), ["Eating Out", "Groceries"]);
    assert.deepEqual(allSubTags(renamed), ["Weekend"]);
    const removed = removeTag(renamed, "eating out");
    assert.deepEqual(tagsOf(removed[1]), ["Weekend"]);
    assert.deepEqual(tagsOf(removeTag([txn("Groceries")], "Groceries")[0]), ["Other"]);
  });
});

describe("tagging every movement of a merchant", () => {
  function row(id: string, merchant: string, tags?: string[]): InterpretedTransaction {
    return { ...txn("Groceries", tags), id, merchant };
  }

  const rows = [
    row("1", "Woolworths"),
    row("2", "WOOLWORTHS"),
    row("3", "Coles", ["Groceries"]),
    row("4", "woolworths "),
  ];

  it("matches a merchant whatever case the statement used", () => {
    assert.ok(sameMerchant("Woolworths", "WOOLWORTHS"));
    assert.ok(sameMerchant("woolworths ", " Woolworths"));
    assert.ok(!sameMerchant("Woolworths", "Woolworths Metro"));
    assert.equal(merchantRows(rows, "woolworths").length, 3);
  });

  it("applies the tags to that merchant and to nothing else", () => {
    const next = tagMerchant(rows, "Woolworths", ["Food", "Weekly Shop"]);
    for (const id of ["1", "2", "4"]) {
      const changed = next.find((r) => r.id === id);
      assert.deepEqual(changed?.tags, ["Food", "Weekly Shop"], `row ${id}`);
      assert.equal(changed?.category, "Food");
      assert.equal(changed?.tagSource, "user");
    }
    const untouched = next.find((r) => r.id === "3");
    assert.deepEqual(untouched?.tags, ["Groceries"]);
    assert.equal(untouched, rows[2], "an unrelated row should not be rebuilt");
  });

  it("leaves the list alone when no movement carries that merchant", () => {
    assert.deepEqual(tagMerchant(rows, "Aldi", ["Food"]), rows);
    assert.equal(merchantRows(rows, "Aldi").length, 0);
  });
});
