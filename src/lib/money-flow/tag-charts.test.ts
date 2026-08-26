import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barLayout, donutPath, nextTagSelection, pieSlices, topChartCategories, withTagColors } from "./tag-charts";

describe("tag charts", () => {
  it("toggles a tag off when it is already selected", () => {
    assert.equal(nextTagSelection("All", "Groceries"), "Groceries");
    assert.equal(nextTagSelection("Groceries", "Groceries"), "All");
    assert.equal(nextTagSelection("Groceries", "Dining"), "Dining");
    assert.equal(nextTagSelection("Dining", "All"), "All");
  });

  it("keeps the top tags and lumps the rest into Other", () => {
    const categories = [
      { name: "Housing", amount: 980, share: 50 },
      { name: "Groceries", amount: 400, share: 20 },
      { name: "Dining", amount: 200, share: 10 },
      { name: "Transport", amount: 150, share: 8 },
      { name: "Shopping", amount: 100, share: 5 },
      { name: "Health", amount: 80, share: 4 },
      { name: "Travel", amount: 40, share: 2 },
      { name: "Entertainment", amount: 20, share: 1 },
    ];
    const charted = topChartCategories(categories, 6);
    assert.equal(charted.length, 6);
    assert.equal(charted[5]?.name, "Other");
    assert.equal(charted[5]?.amount, 140);
  });

  it("builds pie slices that cover a full circle", () => {
    const slices = pieSlices([
      { name: "Housing", amount: 75, share: 75 },
      { name: "Groceries", amount: 25, share: 25 },
    ]);
    assert.equal(slices.length, 2);
    assert.ok(Math.abs(slices[0].startAngle - -Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(slices[1].endAngle - (-Math.PI / 2 + Math.PI * 2)) < 1e-9);
    assert.equal(slices[0].color, "#173b31");
    assert.equal(slices[0].share, 75);
    assert.equal(slices[1].share, 25);
    assert.ok(donutPath(100, 100, 80, 48, slices[0].startAngle, slices[0].endAngle).startsWith("M "));
  });

  it("sizes bars relative to the largest tag", () => {
    const bars = barLayout(withTagColors([{ name: "Housing", amount: 100, share: 67 }, { name: "Dining", amount: 50, share: 33 }]), 200, 100);
    assert.equal(bars[0]?.height, 100);
    assert.equal(bars[1]?.height, 50);
    assert.ok((bars[0]?.width ?? 0) > 0);
  });
});
