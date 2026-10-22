import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { TagChartCard } from "@/components/tag-charts";
import {
  DEFAULT_CHART_RANGE,
  chartModeForRevision,
  chartScale,
  chartWindow,
  chartBucket,
  flowSeries,
  formatChartAxis,
  highlightedSpan,
  spanWindow,
  sydneyDay,
} from "./chart-range";
import { filterByScope } from "./scope";
import { filterByPeriod } from "./period";
import { bumpPeriodRevision, getPeriodRevision } from "./period-revision";
import { summarizeMoneyFlow } from "./summary";
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

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

describe("transactions chart range", () => {
  it("counts a picker write and ignores the stored period", () => {
    const before = getPeriodRevision();
    bumpPeriodRevision();
    assert.equal(getPeriodRevision(), before + 1);
    const provider = readFileSync(new URL("../../components/money-flow-provider.tsx", import.meta.url), "utf8");
    assert.match(provider, /function writePeriod[\s\S]*?bumpPeriodRevision\(\)/);
  });

  it("defaults to 1M until the month picker writes a new period", () => {
    assert.deepEqual(DEFAULT_CHART_RANGE, { kind: "span", span: "1M" });
    const stored = { kind: "month" as const, month: "2026-09" };
    const stayed = chartModeForRevision(0, 0, DEFAULT_CHART_RANGE);
    assert.deepEqual(stayed, { kind: "span", span: "1M" });
    assert.equal(highlightedSpan(stayed, stored), "1M");
    assert.deepEqual(chartWindow(stayed, stored, "2026-10-18"), {
      kind: "range",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const all = { kind: "all" as const };
    assert.deepEqual(chartWindow(stayed, all, "2026-10-18"), {
      kind: "range",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("changes the chart window when a period segment is picked", () => {
    const page = { kind: "month" as const, month: "2026-09" };
    const today = "2026-10-18";
    assert.deepEqual(chartWindow({ kind: "span", span: "1W" }, page, today), {
      kind: "range",
      from: "2026-09-24",
      to: "2026-09-30",
    });
    assert.deepEqual(chartWindow({ kind: "span", span: "1M" }, page, today), {
      kind: "range",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.deepEqual(chartWindow({ kind: "span", span: "3M" }, page, today), {
      kind: "range",
      from: "2026-07-01",
      to: "2026-09-30",
    });
    assert.deepEqual(chartWindow({ kind: "span", span: "6M" }, page, today), {
      kind: "range",
      from: "2026-04-01",
      to: "2026-09-30",
    });
    assert.deepEqual(chartWindow({ kind: "span", span: "All" }, page, today), { kind: "all" });
    assert.deepEqual(spanWindow("1W", "2026-10-18"), { kind: "range", from: "2026-10-12", to: "2026-10-18" });
    assert.deepEqual(spanWindow("1M", "2026-10-18"), { kind: "range", from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(spanWindow("3M", "2026-10-18"), { kind: "range", from: "2026-08-01", to: "2026-10-31" });
    assert.deepEqual(spanWindow("6M", "2026-10-18"), { kind: "range", from: "2026-05-01", to: "2026-10-31" });
    assert.deepEqual(spanWindow("All", "2026-10-18"), { kind: "all" });
  });

  it("follows the page period after the month picker changes", () => {
    const next = { kind: "month" as const, month: "2026-10" };
    const followed = chartModeForRevision(0, 1, { kind: "span", span: "3M" });
    assert.deepEqual(followed, { kind: "page" });
    assert.equal(highlightedSpan(followed, next), "1M");
    assert.deepEqual(chartWindow(followed, next, "2026-10-18"), next);

    const all = { kind: "all" as const };
    const followedAll = chartModeForRevision(1, 2, followed);
    assert.equal(highlightedSpan(followedAll, all), "All");
    assert.deepEqual(chartWindow(followedAll, all, "2026-10-18"), all);
  });

  it("highlights no segment on a custom range and plots that range", () => {
    const custom = { kind: "range" as const, from: "2026-02-03", to: "2026-04-19" };
    const initial = chartModeForRevision(0, 0, DEFAULT_CHART_RANGE);
    assert.equal(highlightedSpan(initial, custom), "1M");

    const followed = chartModeForRevision(0, 1, DEFAULT_CHART_RANGE);
    assert.equal(highlightedSpan(followed, custom), null);
    assert.deepEqual(chartWindow(followed, custom, "2026-10-18"), custom);

    const lastTwelve = { kind: "range" as const, from: "2025-11-01", to: "2026-10-31" };
    assert.equal(highlightedSpan(followed, lastTwelve), null);
    assert.deepEqual(chartWindow(followed, lastTwelve, "2026-10-18"), lastTwelve);
  });

  it("fits three axis labels to the selected series", () => {
    assert.deepEqual(chartScale(5800), { max: 6000, mid: 3000 });
    assert.deepEqual(chartScale(3800), { max: 4000, mid: 2000 });
    assert.equal(formatChartAxis(0), "$0");
    assert.equal(formatChartAxis(3000), "$3k");
    assert.equal(formatChartAxis(6000), "$6k");
    assert.equal(formatChartAxis(2000), "$2k");
    assert.equal(formatChartAxis(4000), "$4k");
  });

  it("plots each day's own money, not a running total, and swaps money in for money out", () => {
    const rows = [
      txn("pay", "2026-10-02", 1200, "salary"),
      txn("shop", "2026-10-06", -80, "groceries"),
      txn("shop2", "2026-10-06", -20, "groceries"),
      txn("fare", "2026-10-11", -22, "transport"),
      { ...txn("move", "2026-10-08", 400, "transfers"), transferPair: "pocket" },
    ];
    const window = { kind: "range" as const, from: "2026-10-01", to: "2026-10-31" };
    const moneyIn = flowSeries(rows, "in", window, "day", "2026-10-31");
    const moneyOut = flowSeries(rows, "out", window, "day", "2026-10-31");
    assert.equal(moneyIn.points.length, 31);
    assert.equal(moneyIn.points[0]?.value, 0);
    assert.equal(moneyIn.points.find((p) => p.key === "2026-10-02")?.value, 1200);
    assert.equal(moneyIn.points.find((p) => p.key === "2026-10-03")?.value, 0);
    assert.equal(moneyIn.points.find((p) => p.key === "2026-10-08")?.value, 0, "transfers stay out");
    assert.equal(moneyIn.total, 1200);
    assert.equal(moneyOut.points.find((p) => p.key === "2026-10-06")?.value, 100);
    assert.equal(moneyOut.points.find((p) => p.key === "2026-10-11")?.value, 22);
    assert.equal(moneyOut.points.at(-1)?.value, 0);
    assert.equal(moneyOut.total, 122);
  });

  it("stops the line at today and fills past quiet days with $0", () => {
    const rows = [txn("pay", "2026-10-02", 1200, "salary")];
    const october = { kind: "month" as const, month: "2026-10" };
    const series = flowSeries(rows, "in", october, "day", "2026-10-22");
    assert.equal(series.points.length, 22);
    assert.equal(series.points.at(-1)?.key, "2026-10-22");
    assert.equal(series.points.at(-1)?.value, 0);

    const november = flowSeries(rows, "in", { kind: "month", month: "2026-11" }, "day", "2026-10-22");
    assert.deepEqual(november.points, []);
    assert.equal(november.hasData, false);
    assert.equal(november.total, 0);

    const quiet = flowSeries([], "in", { kind: "month", month: "2026-09" }, "day", "2026-10-22");
    assert.equal(quiet.hasData, false);
  });

  it("picks daily, Monday weeks, or months by span", () => {
    const page = { kind: "month" as const, month: "2026-10" };
    assert.equal(chartBucket({ kind: "span", span: "1W" }, page), "day");
    assert.equal(chartBucket({ kind: "span", span: "1M" }, page), "day");
    assert.equal(chartBucket({ kind: "span", span: "3M" }, page), "week");
    assert.equal(chartBucket({ kind: "span", span: "6M" }, page), "month");
    assert.equal(chartBucket({ kind: "span", span: "All" }, page), "month");
    assert.equal(chartBucket({ kind: "page" }, page), "day");
    assert.equal(chartBucket({ kind: "page" }, { kind: "all" }), "month");

    const rows = [
      txn("a", "2026-08-02", 10, "salary"), // Sunday: week of Mon 27 Jul
      txn("b", "2026-08-03", 20, "salary"), // Monday: new week
      txn("c", "2026-08-09", 5, "salary"), // Sunday: same week as b
    ];
    const window = { kind: "range" as const, from: "2026-08-01", to: "2026-10-31" };
    const weekly = flowSeries(rows, "in", window, "week", "2026-10-22");
    assert.equal(weekly.points[0]?.key, "2026-07-27");
    assert.equal(weekly.points[0]?.value, 10);
    assert.equal(weekly.points.find((p) => p.key === "2026-08-03")?.value, 25);
    assert.equal(weekly.points.at(-1)?.key, "2026-10-19");
    assert.equal(weekly.total, 35);

    const monthly = flowSeries(rows, "in", { kind: "all" }, "month", "2026-10-22");
    assert.deepEqual(
      monthly.points.map((p) => [p.key, p.value]),
      [
        ["2026-08", 35],
        ["2026-09", 0],
        ["2026-10", 0],
      ],
    );
  });

  it("totals match the Money in and Money out cards for the same period and bank", () => {
    const rows = mixedLedger();
    const nab = filterByScope(rows, { kind: "institution", institution: "NAB" });
    const today = "2026-10-18";
    const august = { kind: "month" as const, month: "2026-08" };
    const augustFlow = summarizeMoneyFlow(filterByPeriod(nab, august));
    assert.equal(augustFlow.cashIn, 29282.95);
    assert.equal(augustFlow.cashOut, 2330.1);
    assert.equal(flowSeries(nab, "in", august, "day", today).total, augustFlow.cashIn);
    assert.equal(flowSeries(nab, "out", august, "day", today).total, augustFlow.cashOut);
    assert.equal(augustFlow.income, 0);

    const sparse = flowSeries(nab.filter((r) => r.id === "nab-interest"), "in", august, "day", today);
    assert.equal(sparse.points.find((p) => p.key === "2026-08-14")?.value, 0);
    assert.equal(sparse.points.find((p) => p.key === "2026-08-15")?.value, 12.4);
    assert.equal(sparse.points.find((p) => p.key === "2026-08-16")?.value, 0);

    const custom = { kind: "range" as const, from: "2026-07-10", to: "2026-08-05" };
    const customFlow = summarizeMoneyFlow(filterByPeriod(nab, custom));
    assert.equal(flowSeries(nab, "in", custom, "day", today).total, customFlow.cashIn);
    assert.equal(flowSeries(nab, "out", custom, "day", today).total, customFlow.cashOut);

    const up = filterByScope(rows, { kind: "institution", institution: "Up" });
    const upFlow = summarizeMoneyFlow(filterByPeriod(up, august));
    assert.equal(flowSeries(up, "in", august, "day", today).total, upFlow.cashIn);
    assert.notEqual(upFlow.cashIn, augustFlow.cashIn);
  });

  it("shows No data for this month in the chart space for an empty month", () => {
    const html = renderToStaticMarkup(
      createElement(TagChartCard, {
        transactions: [txn("pay", "2026-08-02", 1200, "salary")],
        selectedTag: "All",
        onSelectTag: () => undefined,
        pagePeriod: { kind: "month", month: "2026-05" },
        compact: true,
      }),
    );
    assert.match(html, /No data for this month/);
    assert.match(html, /data-chart-empty[^>]*height:180px|height:180px[^>]*data-chart-empty/);
    assert.match(html, /text-sm text-muted">No data for this month/);
    assert.match(html, /\$0\.00/);
    assert.doesNotMatch(html, /Cumulative/);

    // The group chip row stays, greyed out and not tappable, so the card keeps its height.
    const chips = [...html.matchAll(/<button\b[^>]*aria-disabled="true"[^>]*>([^<]*)</g)];
    assert.ok(chips.length >= 2);
    assert.equal(chips[0]?.[1], "All");
    assert.ok(chips.some((chip) => chip[1] === "Food &amp; Drink"));
    for (const chip of chips) {
      assert.match(chip[0], /disabled=""/);
      assert.match(chip[0], /opacity-40/);
    }
  });

  it("renders Money in and 1M selected, with the curve starting on the $0 baseline", () => {
    const card = readFileSync(new URL("../../components/tag-charts.tsx", import.meta.url), "utf8");
    assert.match(card, /chartModeForRevision/);
    assert.match(card, /getPeriodRevision/);
    assert.match(card, /DEFAULT_CHART_RANGE/);
    assert.doesNotMatch(card, /Pie chart/);

    const html = renderToStaticMarkup(
      createElement(TagChartCard, {
        transactions: [
          txn("pay", sydneyDay(), 1200, "salary"),
          txn("shop", sydneyDay(), -80, "groceries"),
        ],
        selectedTag: "All",
        onSelectTag: () => undefined,
        pagePeriod: { kind: "month", month: sydneyDay().slice(0, 7) },
        compact: true,
      }),
    );
    assert.match(html, /Money by group/);
    assert.match(html, /Money in per period by group/);
    assert.equal(html.includes("Money in and out"), false);
    assert.match(html, /aria-pressed="true"[^>]*>Money in</);
    assert.match(html, /aria-pressed="false"[^>]*>Money out</);
    assert.match(html, /aria-pressed="true"[^>]*>1M</);
    assert.match(html, /aria-pressed="false"[^>]*>1W</);
    assert.match(html, /aria-pressed="false"[^>]*>3M</);
    assert.match(html, /aria-pressed="false"[^>]*>All</);
    assert.match(html, />\$0</);
    assert.match(html, /text-\[11px\]/);
    assert.match(html, /gap-3/);
    assert.match(html, /h-8/);
    assert.equal(html.includes(">Pie<"), false);
    assert.equal(html.includes("crispEdges"), false);

    const baseline = [...html.matchAll(/<line\b[^>]*>/g)].map((match) => match[0]).find((line) => line.includes('stroke-opacity="0.8"'));
    const path = html.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
    const moveY = path?.match(/^M [\d.]+ ([\d.]+)/)?.[1];
    assert.ok(baseline);
    assert.match(path ?? "", / C /);
    assert.doesNotMatch(path ?? "", / [HV] /);
    assert.equal(moveY, baseline ? attr(baseline, "y1") : undefined);
  });
});

function row(partial: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "dateIso" | "amount">): InterpretedTransaction {
  return {
    merchant: partial.id,
    categoryKey: "groceries",
    date: partial.dateIso.slice(8),
    type: partial.amount > 0 ? "INCOME" : "SPENDING",
    sourceFile: partial.institution === "Up" ? "up.csv" : "nab.csv",
    confidence: 1,
    institution: "NAB",
    ...partial,
  };
}

/** Several months, both directions, two banks, transfers, and credits that are not marked earned. */
function mixedLedger(): InterpretedTransaction[] {
  return [
    row({ id: "nab-salary", dateIso: "2026-08-03", amount: 4200.55, baseAmount: 1, categoryKey: "salary", institution: "NAB" }),
    row({ id: "nab-loan", dateIso: "2026-08-07", amount: 25000, categoryKey: "uncategorised", type: "borrowed", institution: "NAB" }),
    row({ id: "nab-interest", dateIso: "2026-08-15", amount: 12.4, categoryKey: "other-income", institution: "NAB" }),
    row({ id: "nab-held", dateIso: "2026-08-12", amount: 30, categoryKey: "other-income", status: "HOLD", institution: "NAB" }),
    row({ id: "nab-week", dateIso: "2026-08-28", amount: 40, categoryKey: "other-income", institution: "NAB" }),
    row({ id: "nab-rent", dateIso: "2026-08-01", amount: -1800, categoryKey: "rent-mortgage", institution: "NAB" }),
    row({ id: "nab-shop", dateIso: "2026-08-04", amount: -80.1, categoryKey: "groceries", institution: "NAB" }),
    row({ id: "nab-debt", dateIso: "2026-08-20", amount: -450, categoryKey: "debt-payments", institution: "NAB" }),
    row({ id: "nab-move-out", dateIso: "2026-08-09", amount: -400, categoryKey: "transfers", type: "moved", transferPair: "pocket", institution: "NAB" }),
    row({ id: "nab-move-in", dateIso: "2026-08-09", amount: 400, categoryKey: "transfers", type: "moved", transferPair: "pocket", institution: "NAB" }),
    row({ id: "nab-orphan", dateIso: "2026-08-11", amount: 900, categoryKey: "transfers", type: "TRANSFER", institution: "NAB" }),
    row({ id: "nab-july-early", dateIso: "2026-07-02", amount: 800, categoryKey: "salary", institution: "NAB" }),
    row({ id: "nab-july-shop", dateIso: "2026-07-18", amount: -22, categoryKey: "eating-out", institution: "NAB" }),
    row({ id: "nab-july-pay", dateIso: "2026-07-28", amount: 60, categoryKey: "groceries", institution: "NAB" }),
    row({ id: "nab-june-pay", dateIso: "2026-06-05", amount: 3000, categoryKey: "salary", institution: "NAB" }),
    row({ id: "nab-june-shop", dateIso: "2026-06-06", amount: -40, categoryKey: "groceries", institution: "NAB" }),
    row({ id: "nab-sept-pay", dateIso: "2026-09-03", amount: 4000, categoryKey: "salary", institution: "NAB" }),
    row({ id: "up-pay", dateIso: "2026-08-02", amount: 2100, categoryKey: "salary", institution: "Up" }),
    row({ id: "up-cafe", dateIso: "2026-08-08", amount: -15.5, categoryKey: "eating-out", institution: "Up" }),
  ];
}
