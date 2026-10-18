import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { CustomDatesPanel, PeriodMenu, PeriodPicker } from "@/components/period-picker";
import { lastTwelveMonthsRange } from "@/lib/money-flow/period";
import {
  anchorMonth,
  chooseCustomRange,
  choosePeriod,
  monthsForPicker,
  nextMenuIndex,
  periodMenuEntries,
  periodPickerLabel,
} from "@/lib/money-flow/period-picker";

const months = ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"];

describe("period dropdown", () => {
  it("selects a month", () => {
    const next = choosePeriod({ type: "month", month: "2026-09" }, "2026-10");
    assert.deepEqual(next, { kind: "month", month: "2026-09" });
    assert.equal(periodPickerLabel(next), "September 2026");

    const html = renderToStaticMarkup(
      createElement(PeriodPicker, {
        months,
        period: next,
        anchor: "2026-09",
        onPeriod: () => undefined,
      }),
    );
    assert.match(html, /September 2026/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /h-10/);
    assert.match(html, /border-2/);
    assert.match(html, /bg-surface/);
    assert.match(html, /shadow-card/);
    assert.match(html, /font-sans/);
    assert.equal(html.includes("Last 12 months"), false);
    assert.equal(html.includes(">Period<"), false);
  });

  it("selects Last 12 months", () => {
    const next = choosePeriod({ type: "last12" }, "2026-09");
    assert.deepEqual(next, lastTwelveMonthsRange("2026-09"));
    assert.deepEqual(next, { kind: "range", from: "2025-10-01", to: "2026-09-30" });
    assert.equal(periodPickerLabel(next), "Last 12 months");
    assert.equal(anchorMonth(next, months, "2026-10"), "2026-10");

    const html = renderToStaticMarkup(
      createElement(PeriodPicker, {
        months,
        period: next,
        anchor: "2026-10",
        onPeriod: () => undefined,
      }),
    );
    assert.match(html, />Last 12 months</);
  });

  it("selects All activity", () => {
    const next = choosePeriod({ type: "all" }, "2026-10");
    assert.deepEqual(next, { kind: "all" });
    assert.equal(periodPickerLabel(next), "All activity");

    const html = renderToStaticMarkup(
      createElement(PeriodPicker, {
        months,
        period: next,
        anchor: "2026-10",
        onPeriod: () => undefined,
      }),
    );
    assert.match(html, />All activity</);
  });

  it("selects a custom range", () => {
    const next = chooseCustomRange("2026-08-01", "2026-09-15");
    assert.deepEqual(next, { kind: "range", from: "2026-08-01", to: "2026-09-15" });
    assert.equal(periodPickerLabel(next!), "1 Aug – 15 Sep 2026");
    assert.equal(chooseCustomRange("", "2026-09-15"), null);
    assert.equal(chooseCustomRange("15 Sep 2026", "2026-09-15"), null);

    const html = renderToStaticMarkup(
      createElement(PeriodPicker, {
        months,
        period: next!,
        anchor: "2026-10",
        onPeriod: () => undefined,
      }),
    );
    assert.match(html, /1 Aug – 15 Sep 2026/);
  });

  it("lists months, then Last 12 months, All activity, and Custom dates", () => {
    const entries = periodMenuEntries({ kind: "month", month: "2026-09" }, months, "2026-09");
    assert.deepEqual(
      entries.map((entry) => entry.label),
      ["October 2026", "September 2026", "August 2026", "July 2026", "June 2026", "Last 12 months", "All activity", "Custom dates…"],
    );
    assert.equal(entries.find((entry) => entry.type === "month" && entry.month === "2026-09")?.checked, true);
    assert.equal(entries.filter((entry) => entry.checked).length, 1);

    const html = renderToStaticMarkup(
      createElement(PeriodMenu, {
        id: "period-menu",
        entries,
        activeIndex: 1,
        onActiveIndex: () => undefined,
        onKeyDown: () => undefined,
        onChoose: () => undefined,
        itemRef: () => undefined,
      }),
    );
    assert.match(html, /role="menu"/);
    assert.match(html, />Month</);
    assert.match(html, /September 2026/);
    assert.match(html, /aria-checked="true"/);
    assert.match(html, /bg-accent-surface/);
    assert.match(html, /text-primary/);
    assert.match(html, /Last 12 months/);
    assert.match(html, /All activity/);
    assert.match(html, /Custom dates…/);
    assert.match(html, /role="separator"/);
    const september = html.indexOf("September 2026");
    const lastTwelve = html.indexOf("Last 12 months");
    const all = html.indexOf("All activity");
    const custom = html.indexOf("Custom dates…");
    assert.ok(september < lastTwelve && lastTwelve < all && all < custom);
  });

  it("opens custom dates with From, To, Back, and Apply", () => {
    const html = renderToStaticMarkup(
      createElement(CustomDatesPanel, {
        id: "custom-dates",
        fromRef: { current: null },
        from: "2026-08-01",
        to: "2026-09-15",
        onFrom: () => undefined,
        onTo: () => undefined,
        onBack: () => undefined,
        onApply: () => undefined,
      }),
    );
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-label="Custom dates"/);
    assert.match(html, />From</);
    assert.match(html, />To</);
    assert.match(html, /value="2026-08-01"/);
    assert.match(html, /value="2026-09-15"/);
    assert.match(html, />Back</);
    assert.match(html, />Apply</);
    assert.match(html, /bg-primary/);
  });

  it("keeps a month that is on screen but not in the ledger, newest first", () => {
    assert.deepEqual(monthsForPicker(["2026-08-02", "2026-10-01"], { kind: "month", month: "2026-09" }), [
      "2026-10",
      "2026-09",
      "2026-08",
    ]);
  });

  it("moves the menu highlight with the arrow keys", () => {
    assert.equal(nextMenuIndex(0, 4, "ArrowDown"), 1);
    assert.equal(nextMenuIndex(0, 4, "ArrowUp"), 3);
    assert.equal(nextMenuIndex(2, 4, "Home"), 0);
    assert.equal(nextMenuIndex(2, 4, "End"), 3);
    assert.equal(nextMenuIndex(2, 4, "Escape"), null);
  });
});
