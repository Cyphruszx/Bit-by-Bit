import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignPixelDonutCells,
  CHART_PIXEL,
  closeSteppedArea,
  PIE_PIXEL,
  pixelRingCells,
  snapChart,
  steppedPath,
} from "./chart-pixels";
import { pieSlices } from "./tag-charts";

describe("chart pixels", () => {
  it("snaps coordinates onto the chart grid", () => {
    assert.equal(snapChart(6), 8);
    assert.equal(snapChart(5), 4);
    assert.equal(snapChart(11, 8), 8);
  });

  it("walks a line as horizontal then vertical stairs", () => {
    assert.equal(steppedPath([{ x: 12, y: 20 }, { x: 40, y: 36 }]), "M 12 20 H 40 V 36");
    assert.equal(steppedPath([undefined, { x: 4, y: 4 }]), "M 4 4");
    assert.equal(closeSteppedArea("M 8 20 H 40 V 36", 8, 80), "M 8 20 H 40 V 36 V 80 H 8 Z");
  });

  it("fills a ring with cells on the pie grid", () => {
    const cells = pixelRingCells(80, 80, 64, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
    assert.ok(cells.length > 20);
    for (const cell of cells) {
      assert.equal(cell.size, PIE_PIXEL);
      assert.equal(cell.x % PIE_PIXEL, 0);
      assert.equal(cell.y % PIE_PIXEL, 0);
    }
  });

  it("gives each pie cell to one slice and keeps the larger share bigger", () => {
    const slices = pieSlices([
      { name: "Housing", amount: 75, share: 75 },
      { name: "Groceries", amount: 25, share: 25 },
    ]);
    const assigned = assignPixelDonutCells(slices, 80, 80, 64, 32);
    assert.equal(assigned.length, 2);
    const keys = new Set<string>();
    for (const slice of assigned) {
      for (const cell of slice.cells) {
        const key = `${cell.x},${cell.y}`;
        assert.equal(keys.has(key), false);
        keys.add(key);
      }
    }
    assert.ok((assigned[0]?.cells.length ?? 0) > (assigned[1]?.cells.length ?? 0));
    assert.ok((assigned[1]?.cells.length ?? 0) > 0);
  });

  it("keeps a sliver visible as at least one cell", () => {
    const assigned = assignPixelDonutCells(
      [{ startAngle: -Math.PI / 2, endAngle: -Math.PI / 2 + 0.01 }],
      40,
      40,
      32,
      16,
    );
    assert.equal(assigned[0]?.cells.length, 1);
    assert.equal(CHART_PIXEL, 4);
  });
});
