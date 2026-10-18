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
  cumulativeLine,
  formatChartAxis,
  highlightedSpan,
  spanWindow,
} from "./chart-range";
import { bumpPeriodRevision, getPeriodRevision } from "./period-revision";
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

  it("starts the cumulative line at $0 and swaps money in for money out", () => {
    const rows = [
      txn("pay", "2026-10-02", 1200, "salary"),
      txn("shop", "2026-10-06", -80, "groceries"),
      txn("fare", "2026-10-11", -22, "transport"),
      { ...txn("move", "2026-10-08", 400, "transfers"), transferPair: "pocket" },
    ];
    const window = { kind: "range" as const, from: "2026-10-01", to: "2026-10-31" };
    const moneyIn = cumulativeLine(rows, "in", window);
    const moneyOut = cumulativeLine(rows, "out", window);
    assert.equal(moneyIn[0]?.value, 0);
    assert.equal(moneyIn[0]?.key.startsWith("#"), true);
    assert.equal(moneyOut[0]?.value, 0);
    assert.equal(moneyIn.at(-1)?.value, 1200);
    assert.equal(moneyOut.at(-1)?.value, 102);
    assert.ok(moneyIn.slice(1, 2)[0]?.value === 0);
    const paid = moneyIn.find((point) => point.key === "2026-10-02");
    assert.equal(paid?.value, 1200);
    assert.equal(moneyOut.find((point) => point.key === "2026-10-02")?.value, 0);
    assert.equal(moneyOut.find((point) => point.key === "2026-10-06")?.value, 80);
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
          txn("pay", "2026-10-02", 1200, "salary"),
          txn("shop", "2026-10-06", -80, "groceries"),
        ],
        selectedTag: "All",
        onSelectTag: () => undefined,
        pagePeriod: { kind: "month", month: "2026-09" },
        compact: true,
      }),
    );
    assert.match(html, /Money by group/);
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
