import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  budgetRowsFromPrior,
  monthlyBalanceSeries,
  payRunCount,
  recentLedgerRows,
  spendDonutSlices,
} from "./dashboard";
import type { InterpretedTransaction } from "./types";

function txn(
  id: string,
  dateIso: string,
  amount: number,
  extras: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  return {
    id,
    merchant: extras.merchant ?? "Cafe",
    categoryKey: extras.categoryKey ?? "groceries",
    date: dateIso.slice(8),
    dateIso,
    amount,
    type: extras.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: "demo",
    confidence: 1,
    ...extras,
  };
}

describe("dashboard widgets", () => {
  it("counts salary credits as pay runs", () => {
    const rows = [
      txn("1", "2026-09-10", 3120, { categoryKey: "salary", type: "earned" }),
      txn("2", "2026-09-24", 3120, { categoryKey: "salary", type: "earned" }),
      txn("3", "2026-09-12", 40, { categoryKey: "other-income", type: "earned" }),
      txn("4", "2026-09-11", -80, { categoryKey: "groceries", type: "spent" }),
    ];
    assert.equal(payRunCount(rows), 2);
  });

  it("folds leftover categories into Everything else", () => {
    const slices = spendDonutSlices(
      [
        { name: "housing", amount: 1400, share: 34 },
        { name: "food", amount: 900, share: 22 },
        { name: "transport", amount: 500, share: 12 },
        { name: "lifestyle", amount: 400, share: 10 },
        { name: "health", amount: 300, share: 7 },
        { name: "utilities", amount: 200, share: 5 },
        { name: "misc", amount: 400, share: 10 },
      ],
      6,
    );
    assert.equal(slices.length, 6);
    assert.equal(slices[5]?.label, "Everything else");
    assert.equal(slices[0]?.label, "Housing");
  });

  it("marks a category over when this period beats the last one", () => {
    const rows = budgetRowsFromPrior(
      [
        { name: "food", amount: 486, share: 40 },
        { name: "transport", amount: 204, share: 20 },
      ],
      [
        { name: "food", amount: 400, share: 40 },
        { name: "transport", amount: 350, share: 30 },
      ],
    );
    assert.equal(rows[0]?.over, 86);
    assert.equal(rows[0]?.percent, 100);
    assert.equal(rows[1]?.percent, 58);
    assert.equal(rows[1]?.over, 0);
  });

  it("walks a running position across the last twelve months", () => {
    const rows = [
      txn("1", "2025-08-01", 1000, { categoryKey: "salary", type: "earned" }),
      txn("2", "2026-01-15", 500, { categoryKey: "salary", type: "earned" }),
      txn("3", "2026-09-10", -200, { categoryKey: "groceries", type: "spent" }),
    ];
    const months = [
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ];
    const series = monthlyBalanceSeries(rows, months);
    assert.equal(series[0]?.value, 1000);
    assert.equal(series[3]?.value, 1500);
    assert.equal(series[11]?.value, 1300);
  });

  it("lists the newest ledger rows with a running cash position", () => {
    const rows = recentLedgerRows([
      txn("a", "2026-09-10", 100, { merchant: "Pay", categoryKey: "salary", type: "earned" }),
      txn("b", "2026-09-11", -40, { merchant: "Cafe", categoryKey: "eating-out", type: "spent" }),
      txn("c", "2026-09-12", -10, { merchant: "Bus", categoryKey: "getting-around", type: "spent" }),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.merchant, row.position]),
      [
        ["Bus", 50],
        ["Cafe", 60],
        ["Pay", 100],
      ],
    );
  });
});
