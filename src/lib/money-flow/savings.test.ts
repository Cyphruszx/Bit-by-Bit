import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isIncludedInTotal,
  monthlyTransferSeries,
  monthsToPot,
  potsInTotal,
  prependRecordedMonths,
  projectedPotSeries,
  projectedSavingsPath,
  recordSavingsSnapshot,
  savingsProgressSeries,
  type SavingsPot,
} from "./savings";
import type { InterpretedTransaction } from "./types";

const emergency: SavingsPot = {
  id: "emergency",
  name: "Emergency fund",
  detail: "",
  saved: 8400,
  target: 12000,
  monthlyContribution: 400,
};

const japan: SavingsPot = {
  id: "japan",
  name: "Japan trip",
  detail: "",
  saved: 2150,
  target: 4500,
  monthlyContribution: 250,
};

describe("savings path", () => {
  it("starts at current saved and caps at the target", () => {
    const points = projectedSavingsPath([emergency], { fromIso: "2026-08-25", maxMonths: 18 });
    assert.equal(points[0]?.key, "2026-08");
    assert.equal(points[0]?.label, "Aug 2026");
    assert.equal(points[0]?.value, 8400);
    assert.equal(points[1]?.value, 8800);
    assert.equal(points.at(-1)?.value, 12000);
    assert.ok(points.every((point) => point.value <= 12000));
  });

  it("keeps at least six months when the pot is already funded", () => {
    const funded = { ...emergency, saved: 12000 };
    const points = projectedSavingsPath([funded], { fromIso: "2026-08-01" });
    assert.equal(points.length, 6);
    assert.ok(points.every((point) => point.value === 12000));
  });

  it("aligns each pot to the same months as the combined path", () => {
    const combined = projectedSavingsPath([emergency, japan], { fromIso: "2026-08-01", maxMonths: 12 });
    const pots = projectedPotSeries([emergency, japan], { fromIso: "2026-08-01", maxMonths: 12 });
    assert.equal(pots.length, 2);
    assert.deepEqual(
      pots[0]?.points.map((point) => point.key),
      combined.map((point) => point.key),
    );
    assert.equal(pots[0]?.points[0]?.value, 8400);
    assert.equal(pots[1]?.points[0]?.value, 2150);
  });

  it("prepends earlier recorded months onto the projected path", () => {
    const projected = projectedSavingsPath([emergency], { fromIso: "2026-08-01", minMonths: 3, maxMonths: 3 });
    const merged = prependRecordedMonths(
      [
        { date: "2026-06-15", totalSaved: 7600 },
        { date: "2026-07-20", totalSaved: 8000 },
        { date: "2026-07-28", totalSaved: 8200 },
      ],
      projected,
    );
    assert.equal(merged[0]?.key, "2026-06");
    assert.equal(merged[0]?.value, 7600);
    assert.equal(merged[1]?.key, "2026-07");
    assert.equal(merged[1]?.value, 8200);
    assert.equal(merged[2]?.key, "2026-08");
    assert.equal(merged[2]?.value, 8400);
  });

  it("draws a target line across the same months as saved", () => {
    const { saved, target } = savingsProgressSeries([emergency], [{ date: "2026-06-01", totalSaved: 7600 }], {
      fromIso: "2026-08-01",
      minMonths: 4,
      maxMonths: 4,
    });
    assert.equal(saved.length, target.length);
    assert.ok(target.every((point) => point.value === 12000));
    assert.equal(saved[0]?.key, "2026-06");
  });
});

describe("savings snapshots", () => {
  it("replaces the same calendar day and skips unchanged totals", () => {
    const first = recordSavingsSnapshot([emergency], [], "2026-08-26");
    assert.deepEqual(first, [{ date: "2026-08-26", totalSaved: 8400 }]);
    const sameDay = recordSavingsSnapshot([{ ...emergency, saved: 8500 }], first, "2026-08-26");
    assert.deepEqual(sameDay, [{ date: "2026-08-26", totalSaved: 8500 }]);
    const unchanged = recordSavingsSnapshot([{ ...emergency, saved: 8500 }], sameDay, "2026-08-27");
    assert.equal(unchanged, sameDay);
  });
});

describe("include in total", () => {
  it("drops hidden pots from the combined path", () => {
    const hidden = { ...japan, includedInTotal: false };
    const included = potsInTotal([emergency, hidden]);
    assert.equal(isIncludedInTotal(emergency), true);
    assert.equal(isIncludedInTotal(hidden), false);
    assert.deepEqual(
      included.map((pot) => pot.id),
      ["emergency"],
    );
    const points = projectedSavingsPath(included, { fromIso: "2026-08-01", maxMonths: 18 });
    assert.equal(points[0]?.value, 8400);
    assert.ok(points.every((point) => point.value <= 12000));
    const snaps = recordSavingsSnapshot([emergency, hidden], [], "2026-08-26");
    assert.equal(snaps[0]?.totalSaved, 10550);
  });
});

describe("months to pot", () => {
  it("returns remaining months or null when there is no contribution", () => {
    assert.equal(monthsToPot(emergency), 9);
    assert.equal(monthsToPot({ ...emergency, saved: 12000 }), 0);
    assert.equal(monthsToPot({ ...emergency, monthlyContribution: 0 }), null);
  });
});

describe("monthly transfers", () => {
  it("totals set-aside transfers by month", () => {
    const series = monthlyTransferSeries([
      txn({ id: "1", merchant: "Transfer", amount: -400, dateIso: "2026-07-12", type: "transfer" }),
      txn({ id: "2", merchant: "Transfer", amount: -400, dateIso: "2026-08-12", type: "transfer" }),
      txn({ id: "3", merchant: "Woolworths", amount: -86.4, dateIso: "2026-08-04", type: "expense" }),
    ]);
    assert.deepEqual(
      series.map((point) => [point.key, point.value]),
      [
        ["2026-07", 400],
        ["2026-08", 400],
      ],
    );
  });
});

function txn(
  partial: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "merchant" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    category: "Goals",
    date: "1 Aug",
    type: "expense",
    sourceFile: "demo",
    confidence: 1,
    ...partial,
  };
}
