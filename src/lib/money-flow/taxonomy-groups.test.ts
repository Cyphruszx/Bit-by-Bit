import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATEGORY_GROUPS,
  CATEGORY_KEYS,
  defaultCategoryForGroup,
  groupOf,
  OTHER,
  UNCATEGORISED,
} from "./taxonomy";

describe("category groups", () => {
  it("puts every category in exactly one group", () => {
    const seen = CATEGORY_GROUPS.flatMap((group) => group.categories);
    assert.deepEqual([...seen].sort(), [...CATEGORY_KEYS].sort());
    assert.equal(new Set(seen).size, seen.length);
  });

  it("reads the folders a person would reach for", () => {
    assert.equal(groupOf("income").label, "Income");
    assert.equal(groupOf("home").label, "Housing");
    assert.equal(groupOf("utilities").label, "Housing");
    assert.equal(groupOf("food").label, "Food");
    assert.equal(groupOf("transport").label, "Transport");
    assert.equal(groupOf("shopping").label, "Lifestyle");
    assert.equal(groupOf("leisure").label, "Lifestyle");
    assert.equal(groupOf("travel").label, "Lifestyle");
    assert.equal(groupOf("people").label, "Lifestyle");
    assert.equal(groupOf("health").label, "Health");
    assert.equal(groupOf("money").label, "Commitments");
    assert.equal(groupOf("debt").label, "Commitments");
    assert.equal(groupOf("invest").label, "Commitments");
    assert.equal(groupOf("govt").label, "Giving and Government");
    assert.equal(groupOf(OTHER).label, "Other");
    assert.equal(groupOf(UNCATEGORISED).label, "Other");
    assert.equal(groupOf("not-a-real-key").label, "Other");
  });

  it("keeps the current category when the group already holds it", () => {
    assert.equal(defaultCategoryForGroup("housing", "utilities"), "utilities");
  });

  it("moves to the first category in a group that does not hold the current one", () => {
    assert.equal(defaultCategoryForGroup("food", "home"), "food");
    assert.equal(defaultCategoryForGroup("other", "food"), OTHER);
  });
});
