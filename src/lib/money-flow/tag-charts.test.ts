import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  barAxisTicks,
  barLayout,
  donutPath,
  nextTagSelection,
  orderByFlow,
  pieSlices,
  topChartCategories,
  withTagColors,
} from "./tag-charts";

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

  it("hangs negative bars below a shared zero line", () => {
    const bars = barLayout(
      withTagColors([
        { name: "Income", amount: 300, share: 60 },
        { name: "Rent", amount: -100, share: 20 },
      ]),
      200,
      100,
    );
    const [income, rent] = bars;
    assert.equal(income?.zeroY, 75);
    assert.equal(rent?.zeroY, 75);
    assert.equal(income?.height, 75);
    assert.equal(income?.y, 0);
    assert.equal(rent?.height, 25);
    assert.equal(rent?.y, 75);
  });

  it("keeps a tag that rounds to nothing visible against a much larger one", () => {
    const bars = barLayout(
      withTagColors([
        { name: "Income", amount: 7860, share: 97 },
        { name: "Coffee", amount: -19, share: 1 },
      ]),
      200,
      100,
    );
    assert.ok((bars[1]?.height ?? 0) >= 2);
  });

  it("ticks the axis at the extremes and zero", () => {
    assert.deepEqual(
      barAxisTicks([
        { name: "Income", amount: 300, share: 60 },
        { name: "Rent", amount: -100, share: 20 },
      ]),
      [300, 0, -100],
    );
    assert.deepEqual(barAxisTicks([{ name: "Rent", amount: -100, share: 100 }]), [0, -100]);
  });

  it("sizes slices by magnitude and records their direction", () => {
    const slices = pieSlices([
      { name: "Income", amount: 300, share: 0 },
      { name: "Rent", amount: -100, share: 0 },
    ]);
    assert.equal(slices[0]?.share, 75);
    assert.equal(slices[0]?.direction, "in");
    assert.equal(slices[1]?.share, 25);
    assert.equal(slices[1]?.direction, "out");
    assert.ok(Math.abs((slices[1]?.endAngle ?? 0) - (-Math.PI / 2 + Math.PI * 2)) < 1e-9);
  });

  it("orders money in ahead of money out", () => {
    assert.deepEqual(
      orderByFlow([
        { name: "Rent", amount: -900, share: 0 },
        { name: "Coffee", amount: -20, share: 0 },
        { name: "Salary", amount: 300, share: 0 },
      ]).map((row) => row.name),
      ["Salary", "Rent", "Coffee"],
    );
  });

  it("lumps the tail into Other using signed sums", () => {
    const charted = topChartCategories(
      [
        { name: "Salary", amount: 500, share: 0 },
        { name: "Rent", amount: -300, share: 0 },
        { name: "Refund", amount: 60, share: 0 },
        { name: "Coffee", amount: -40, share: 0 },
      ],
      3,
    );
    assert.equal(charted.length, 3);
    assert.equal(charted[2]?.name, "Other");
    assert.equal(charted[2]?.amount, 20);
  });
});
