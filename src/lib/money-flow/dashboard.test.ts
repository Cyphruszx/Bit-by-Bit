import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountsByInstitution } from "./accounts";
import {
  accountDisplayAmount,
  bankInstitutionTiles,
  budgetRowsFromPrior,
  institutionAccountName,
  monthlyBalanceSeries,
  payRunCount,
  recentLedgerRows,
  spendDonutSlices,
  spendFillToken,
  stackedBarPercents,
  totalAccountBalance,
} from "./dashboard";
import { summarizeMoneyFlow } from "./summary";
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

  it("scales stacked spend and budget bars to the larger figure", () => {
    assert.deepEqual(stackedBarPercents(1420, 1350), { spend: 100, budget: 95 });
    assert.deepEqual(stackedBarPercents(720, 800), { spend: 90, budget: 100 });
    assert.deepEqual(stackedBarPercents(7800, 0), { spend: 100, budget: 0 });
    assert.deepEqual(stackedBarPercents(0, 0), { spend: 0, budget: 0 });
  });

  it("cycles spend fills through brand and chart tokens", () => {
    assert.equal(spendFillToken(0), "bg-primary");
    assert.equal(spendFillToken(1), "bg-chart-1");
    assert.equal(spendFillToken(4), "bg-chart-4");
    assert.equal(spendFillToken(5), "bg-primary");
  });

  it("strips the institution prefix from a compact account row", () => {
    assert.equal(institutionAccountName("NAB · Everyday", "NAB"), "Everyday");
    assert.equal(institutionAccountName("Smart Access", "CommBank"), "Smart Access");
  });

  it("prefers a stored cleared balance and does not invent a $0 skeleton", () => {
    assert.equal(
      accountDisplayAmount("NAB · Everyday", 100, { "NAB · Everyday": { clearedBalance: 4280.12 } }),
      4280.12,
    );
    assert.equal(accountDisplayAmount("NAB · Everyday", 100, {}), 100);
    assert.equal(accountDisplayAmount("NAB · Everyday", null, {}), null);
  });

  it("keeps 1–3 real account rows per bank and does not merge soft-pool balances", () => {
    const rows = [
      txn("1", "2026-03-01", 4280, { accountId: "NAB · Everyday", institution: "NAB", type: "earned", categoryKey: "salary" }),
      txn("2", "2026-03-01", 12400, { accountId: "NAB · Savings", institution: "NAB", type: "earned", categoryKey: "salary" }),
      txn("3", "2026-03-01", 2145, { accountId: "CommBank · Smart Access", institution: "CommBank", type: "earned", categoryKey: "salary" }),
    ];
    const groups = accountsByInstitution(rows);
    const tiles = bankInstitutionTiles(groups, {
      meta: {
        "NAB · Everyday": { clearedBalance: 4280.12 },
        "NAB · Savings": { clearedBalance: 12400 },
        "CommBank · Smart Access": { clearedBalance: 2145.67 },
      },
      book: {
        pools: [
          {
            id: "holiday",
            userId: "u",
            name: "Holiday",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        members: [
          { poolId: "holiday", accountId: "NAB · Everyday", addedAt: "2026-01-01T00:00:00.000Z" },
          { poolId: "holiday", accountId: "NAB · Savings", addedAt: "2026-01-02T00:00:00.000Z" },
        ],
      },
    });

    const nab = tiles.find((tile) => tile.institution === "NAB");
    const commbank = tiles.find((tile) => tile.institution === "CommBank");
    assert.equal(nab?.accounts.length, 2);
    assert.equal(commbank?.accounts.length, 1);
    assert.deepEqual(
      nab?.accounts.map((account) => [account.name, account.amount]),
      [
        ["Everyday", 4280.12],
        ["Savings", 12400],
      ],
    );
    assert.notEqual(
      (nab?.accounts[0]?.amount ?? 0) + (nab?.accounts[1]?.amount ?? 0),
      nab?.accounts[0]?.amount,
    );
  });

  it("sums Total balance from the same amounts Bank Accounts cards show", () => {
    const rows = [
      txn("1", "2026-03-01", 3000, { accountId: "NAB · Everyday", institution: "NAB", type: "earned", categoryKey: "salary" }),
      txn("2", "2026-03-02", -120, { accountId: "NAB · Everyday", institution: "NAB", type: "spent" }),
      txn("3", "2026-03-03", 80, {
        accountId: "NAB · Everyday",
        institution: "NAB",
        type: "returned",
        refundPair: "2~3",
        merchant: "Kmart",
      }),
      txn("4", "2026-03-01", 12400, { accountId: "NAB · Savings", institution: "NAB", type: "earned", categoryKey: "salary" }),
    ];
    rows[1] = { ...rows[1], refundPair: "2~3" };
    const groups = accountsByInstitution(rows);
    const tiles = bankInstitutionTiles(groups, {
      meta: {
        "NAB · Everyday": { clearedBalance: 4280.12 },
        "NAB · Savings": { clearedBalance: 12400 },
      },
    });
    const flow = summarizeMoneyFlow(rows);

    assert.equal(totalAccountBalance(tiles), 16680.12);
    assert.notEqual(totalAccountBalance(tiles), flow.net, "not parked Net Money(P)");
    assert.notEqual(totalAccountBalance(tiles), flow.cashNet, "not period money-in − money-out");
  });

  it("keeps PENDING out of Total balance when falling back to derived movements", () => {
    const rows = [
      txn("cleared", "2026-09-19", 1000, {
        accountId: "NAB · Everyday",
        institution: "NAB",
        type: "earned",
        categoryKey: "salary",
        status: "CLEARED",
      }),
      txn("pending", "2026-09-19", -80, {
        accountId: "NAB · Everyday",
        institution: "NAB",
        type: "spent",
        status: "PENDING",
      }),
    ];
    const tiles = bankInstitutionTiles(accountsByInstitution(rows));
    assert.equal(totalAccountBalance(tiles), 1000);
    assert.equal(summarizeMoneyFlow(rows).cashOut, 80, "raw Money out still sees the pending debit");
    assert.equal(summarizeMoneyFlow(rows).spending, 0);
  });

  it("returns no Total balance when every card is missing a figure", () => {
    assert.equal(totalAccountBalance([{ institution: "NAB", accounts: [{ id: "NAB · Everyday", name: "Everyday", amount: null }] }]), null);
  });

  it("lets derived Total balance differ from Spec 10 Net when a credit is not earnings", () => {
    const rows = [
      txn("pay", "2026-03-06", 3000, {
        accountId: "NAB · Everyday",
        institution: "NAB",
        type: "earned",
        categoryKey: "salary",
      }),
      txn("loan", "2026-03-07", 25000, {
        accountId: "NAB · Everyday",
        institution: "NAB",
        type: "borrowed",
        categoryKey: "uncategorised",
        merchant: "Lender",
      }),
      txn("shop", "2026-03-08", -40, { accountId: "NAB · Everyday", institution: "NAB", type: "spent" }),
    ];
    const tiles = bankInstitutionTiles(accountsByInstitution(rows));
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.net, 2960);
    assert.equal(totalAccountBalance(tiles), 27960);
    assert.notEqual(totalAccountBalance(tiles), flow.net);
  });

  it("uses raw cashIn/cashOut for Money in and Money out, not Income/Spending", () => {
    const rows = [
      txn("pay", "2026-03-06", 3000, { type: "earned", categoryKey: "salary" }),
      txn("loan", "2026-03-07", 25000, { type: "borrowed", categoryKey: "uncategorised", merchant: "Lender" }),
      txn("shop", "2026-03-08", -40, { type: "spent" }),
      txn("move-out", "2026-03-09", -400, { type: "moved", transferPair: "pair", accountId: "Up · Spending" }),
      txn("move-in", "2026-03-09", 400, { type: "moved", transferPair: "pair", accountId: "Up · Save!!" }),
    ];
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.income, 3000);
    assert.equal(flow.spending, 40);
    assert.equal(flow.cashIn, 28400, "direction only: salary + loan + transfer in");
    assert.equal(flow.cashOut, 440, "direction only: shop + transfer out");
    assert.notEqual(flow.cashIn, flow.income);
    assert.notEqual(flow.cashOut, flow.spending);
  });
});
