import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allTags, removeTag, renameTag, tagsOf, tidyTag, withTags } from "./tags";
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
    assert.equal(next.tagSource, "user");
  });

  it("renames and removes a tag across the list", () => {
    const rows = [txn("Groceries"), txn("Dining", ["Dining", "Weekend"])];
    const renamed = renameTag(rows, "dining", "eating out");
    assert.deepEqual(allTags(renamed), ["Eating Out", "Groceries", "Weekend"]);
    const removed = removeTag(renamed, "eating out");
    assert.deepEqual(tagsOf(removed[1]), ["Weekend"]);
    assert.deepEqual(tagsOf(removeTag([txn("Groceries")], "Groceries")[0]), ["Other"]);
  });
});
