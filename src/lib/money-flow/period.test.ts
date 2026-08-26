import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describePeriod,
  filterByPeriod,
  formatMonthLabel,
  inPeriod,
  monthBounds,
  monthsFromDates,
  parsePeriod,
  shiftMonth,
  summarizePeriod,
  type PeriodFilter,
} from "./period";
import type { InterpretedTransaction } from "./types";

function txn(id: string, dateIso: string, amount = -10): InterpretedTransaction {
  return {
    id,
    merchant: "Cafe",
    category: "Dining",
    date: dateIso.slice(8),
    dateIso,
    amount,
    type: amount > 0 ? "income" : "expense",
    sourceFile: "demo",
    confidence: 1,
  };
}

describe("period filtering", () => {
  it("lists months newest first", () => {
    assert.deepEqual(monthsFromDates(["2026-07-15", "2026-08-01", "2026-08-25"]), ["2026-08", "2026-07"]);
  });

  it("knows inclusive month and range bounds", () => {
    assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthBounds("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
    assert.equal(inPeriod("2026-08-01", { kind: "month", month: "2026-08" }), true);
    assert.equal(inPeriod("2026-07-31", { kind: "month", month: "2026-08" }), false);
    const range: PeriodFilter = { kind: "range", from: "2026-08-10", to: "2026-08-18" };
    assert.equal(inPeriod("2026-08-10", range), true);
    assert.equal(inPeriod("2026-08-18", range), true);
    assert.equal(inPeriod("2026-08-09", range), false);
    assert.equal(inPeriod("2026-08-15", { kind: "range", from: "2026-08-18", to: "2026-08-10" }), true);
  });

  it("filters transactions and summarises the chosen period", () => {
    const rows = [
      txn("1", "2026-07-18", 2620),
      txn("2", "2026-07-15", -980),
      txn("3", "2026-08-18", 2620),
      txn("4", "2026-08-15", -980),
    ];
    const august = filterByPeriod(rows, { kind: "month", month: "2026-08" });
    assert.deepEqual(
      august.map((row) => row.id),
      ["3", "4"],
    );
    const summary = summarizePeriod(rows, { kind: "month", month: "2026-08" });
    assert.equal(summary.income, 2620);
    assert.equal(summary.spending, 980);
    assert.equal(summary.periodLabel, "August 2026");
    assert.equal(summarizePeriod(rows, { kind: "all" }).income, 5240);
  });

  it("labels custom ranges and empty months", () => {
    assert.equal(formatMonthLabel("2026-08"), "August 2026");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(describePeriod({ kind: "range", from: "2026-08-01", to: "2026-08-10" }), "1 Aug – 10 Aug");
    const empty = summarizePeriod([], { kind: "month", month: "2026-07" });
    assert.equal(empty.transactionCount, 0);
    assert.match(empty.insights[0] ?? "", /July 2026/);
  });

  it("parses stored period values and rejects junk", () => {
    assert.deepEqual(parsePeriod({ kind: "month", month: "2026-07" }), { kind: "month", month: "2026-07" });
    assert.deepEqual(parsePeriod({ kind: "range", from: "2026-08-01", to: "2026-08-12" }), {
      kind: "range",
      from: "2026-08-01",
      to: "2026-08-12",
    });
    assert.deepEqual(parsePeriod({ kind: "month", month: "08" }), { kind: "all" });
  });
});
