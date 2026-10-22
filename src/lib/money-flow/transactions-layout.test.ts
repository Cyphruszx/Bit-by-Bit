import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { TagChartCard } from "@/components/tag-charts";
import type { InterpretedTransaction } from "./types";

function txn(id: string, dateIso: string, amount: number, categoryKey: string): InterpretedTransaction {
  return {
    id,
    merchant: id,
    categoryKey,
    date: dateIso.slice(8),
    dateIso,
    amount,
    type: amount > 0 ? "earned" : "spent",
    sourceFile: "demo",
    confidence: 1,
    verdict: amount > 0 ? { because: "earned", counts: true, at: "2026-01-01T00:00:00.000Z" } : undefined,
  };
}

describe("transactions page layout", () => {
  it("puts the chart under the heading, then banks, totals, and the ledger", () => {
    const view = readFileSync(new URL("../../app/(app)/transactions/transactions-view.tsx", import.meta.url), "utf8");
    const firstHeading = view.indexOf("<h1 className=\"text-2xl\">Transactions</h1>");
    const heading = view.indexOf("<h1 className=\"text-2xl\">Transactions</h1>", firstHeading + 1);
    const chart = view.indexOf("<TagChartCard");
    const banks = view.indexOf("<ScopeBar");
    const moneyIn = view.indexOf('label="Money in"');
    const moneyOut = view.indexOf('label="Money out"');
    const balance = view.indexOf('label="Account balance"');
    const ledger = view.indexOf("<TransactionTable");
    assert.ok(heading >= 0 && heading < chart && chart < banks && banks < moneyIn);
    assert.ok(moneyIn < moneyOut && moneyOut < balance && balance < ledger);
    assert.equal(view.includes("tracking-[0.16em]"), false);
    assert.equal(view.includes("describeScope"), false);
    assert.equal(view.includes("Charts group by category"), false);
    assert.equal(view.includes("LearnedList"), false);
    assert.equal(view.includes("Your tags"), false);
    assert.match(view, /transactions=\{scopedHoldings\}/);
    assert.match(view, /pagePeriod=\{period\}/);
    assert.equal(view.includes("lineOnly"), false);
  });

  it("keeps Date, Merchant, Amount, Account, Group and Category, and drops Tag and Type", () => {
    const table = readFileSync(new URL("../../components/transaction-table.tsx", import.meta.url), "utf8");
    const date = table.indexOf(">Date</HeaderCell>");
    const merchant = table.indexOf(">Merchant</HeaderCell>");
    const amount = table.indexOf(">Amount</HeaderCell>");
    const account = table.indexOf(">Account</HeaderCell>");
    const group = table.indexOf(">Group</HeaderCell>");
    const category = table.indexOf(">Category</HeaderCell>");
    assert.ok(date < merchant && merchant < amount && amount < account && account < group && group < category);
    assert.equal(table.includes(">Type</HeaderCell>"), false);
    assert.equal(table.includes(">Tag</HeaderCell>"), false);
    assert.equal(table.includes("function TagCell"), false);
    assert.match(table, /table-fixed/);
    assert.match(table, /Show statement/);
  });

  it("draws the group chart as a smooth line and does not mount the pixel pie", () => {
    const html = renderToStaticMarkup(
      createElement(TagChartCard, {
        transactions: [
          txn("pay", "2026-10-02", 1200, "salary"),
          txn("shop", "2026-10-06", -80, "groceries"),
          txn("fare", "2026-10-11", -22, "transport"),
        ],
        selectedTag: "All",
        onSelectTag: () => undefined,
        compact: true,
      }),
    );
    assert.match(html, /Money by group/);
    assert.equal(html.includes("Money in and out by group"), false);
    assert.match(html, /geometricPrecision/);
    assert.match(html, / C /);
    assert.equal(html.includes(">Pie<"), false);
    assert.equal(html.includes("Pie chart of money"), false);
    assert.equal(html.includes("crispEdges"), false);
  });
});
