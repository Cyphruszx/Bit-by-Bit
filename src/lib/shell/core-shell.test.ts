import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORE_NAV,
  DEFAULT_SHELL,
  OMIT_FROM_NAV_AND_OFFER,
  SPEC_11_LOCKED,
  dismissOffer,
  enableOffer,
  hasFirstCleared,
  navLabels,
  navLinks,
  offerLabels,
  parseShell,
  persistable,
  setFeature,
  setLinkedAccounts,
  upsertGoal,
  visibleWidgets,
} from "./core-shell";

describe("Spec 5 Core nav hygiene", () => {
  it("day-one nav is Upload, Dashboard, Transactions, Accounts", () => {
    assert.deepEqual(navLabels(DEFAULT_SHELL), ["Upload", "Dashboard", "Transactions", "Accounts"]);
    assert.deepEqual(
      navLinks(DEFAULT_SHELL).map((link) => link.href),
      ["/upload", "/dashboard", "/transactions", "/accounts"],
    );
    assert.deepEqual(
      CORE_NAV.map((link) => link.label),
      ["Upload", "Dashboard", "Transactions", "Accounts"],
    );
  });

  it("omits Recurring, Cash Flow, Categories, Savings, Budget, Goals, and Linked balances from day-one nav", () => {
    const labels = navLabels(DEFAULT_SHELL).map((label) => label.toLowerCase());
    for (const banned of [
      "recurring",
      "cash flow",
      "categories",
      "savings",
      "budget",
      "goals",
      "linked balances",
      ...OMIT_FROM_NAV_AND_OFFER,
    ]) {
      assert.equal(labels.includes(banned), false, `${banned} leaked into day-one nav`);
    }
  });
});

describe("Spec 5 Goals and Linked balances off by default", () => {
  it("starts with both features off and only money tiles visible", () => {
    assert.equal(DEFAULT_SHELL.enabled.goals, false);
    assert.equal(DEFAULT_SHELL.enabled.linkedBalances, false);
    assert.deepEqual(visibleWidgets(DEFAULT_SHELL), ["money-tiles"]);
    assert.equal(DEFAULT_SHELL.goals.length, 0);
  });

  it("does not put Goals or Linked balances in nav until enabled", () => {
    assert.equal(navLabels(DEFAULT_SHELL).includes("Goals"), false);
    assert.equal(navLabels(DEFAULT_SHELL).includes("Linked balances"), false);
    const on = setFeature(setFeature(DEFAULT_SHELL, "goals", true), "linked-balances", true);
    assert.deepEqual(navLabels(on).slice(-2), ["Goals", "Linked balances"]);
  });
});

describe("Spec 5 enable-offer hygiene", () => {
  const cleared = [{ status: "CLEARED" as const }];

  it("offers nothing before the first CLEARED row", () => {
    assert.equal(hasFirstCleared([]), false);
    assert.equal(hasFirstCleared([{ status: "DUPLICATE_HOLD" }]), false);
    assert.equal(hasFirstCleared([{ status: "HOLD" }]), false);
    assert.deepEqual(offerLabels(DEFAULT_SHELL, false), []);
    assert.deepEqual(enableOffer(DEFAULT_SHELL, hasFirstCleared([])), []);
  });

  it("after first CLEARED offers Goals and Linked balances only", () => {
    assert.equal(hasFirstCleared(cleared), true);
    assert.deepEqual(offerLabels(DEFAULT_SHELL, true), ["Goals", "Linked balances"]);
    const labels = offerLabels(DEFAULT_SHELL, true).map((label) => label.toLowerCase());
    for (const banned of ["recurring", "cash flow", "budget", ...OMIT_FROM_NAV_AND_OFFER]) {
      assert.equal(labels.includes(banned), false, `${banned} leaked into enable offer`);
    }
    assert.equal(SPEC_11_LOCKED, false);
    assert.equal(offerLabels(DEFAULT_SHELL, true, SPEC_11_LOCKED).includes("Budget"), false);
  });

  it("drops an item from the offer once that feature is on, and honour dismiss", () => {
    const goalsOn = setFeature(DEFAULT_SHELL, "goals", true);
    assert.deepEqual(offerLabels(goalsOn, true), ["Linked balances"]);
    assert.deepEqual(offerLabels(dismissOffer(DEFAULT_SHELL), true), []);
  });
});

describe("Spec 5 layout archive + restore + persist", () => {
  it("toggle off archives the layout entry and keeps Goals / Linked data", () => {
    const seeded = setLinkedAccounts(
      upsertGoal(DEFAULT_SHELL, { id: "holiday", name: "Holiday", allocated: 400 }),
      ["acct:up-save"],
    );
    const enabled = setFeature(setFeature(seeded, "goals", true), "linked-balances", true);
    const goalsIndex = enabled.widgets.findIndex((entry) => entry.id === "goals");
    const linkedIndex = enabled.widgets.findIndex((entry) => entry.id === "linked-balances");
    assert.ok(goalsIndex > 0);
    assert.ok(linkedIndex > 0);
    assert.deepEqual(visibleWidgets(enabled), ["money-tiles", "goals", "linked-balances"]);

    const off = setFeature(setFeature(enabled, "goals", false), "linked-balances", false);
    assert.equal(off.enabled.goals, false);
    assert.equal(off.enabled.linkedBalances, false);
    assert.equal(off.widgets[goalsIndex]?.id, "goals");
    assert.equal(off.widgets[goalsIndex]?.archived, true);
    assert.equal(off.widgets[linkedIndex]?.id, "linked-balances");
    assert.equal(off.widgets[linkedIndex]?.archived, true);
    assert.equal(off.goals[0]?.allocated, 400);
    assert.deepEqual(off.linkedAccountIds, ["acct:up-save"]);
    assert.deepEqual(visibleWidgets(off), ["money-tiles"]);
    assert.equal(navLabels(off).includes("Goals"), false);

    const restored = setFeature(setFeature(off, "linked-balances", true), "goals", true);
    assert.equal(restored.widgets[goalsIndex]?.id, "goals");
    assert.equal(restored.widgets[goalsIndex]?.archived, false);
    assert.equal(restored.widgets[linkedIndex]?.id, "linked-balances");
    assert.equal(restored.widgets[linkedIndex]?.archived, false);
    assert.deepEqual(visibleWidgets(restored), ["money-tiles", "goals", "linked-balances"]);
    assert.equal(restored.goals[0]?.name, "Holiday");
    assert.deepEqual(restored.linkedAccountIds, ["acct:up-save"]);
  });

  it("round-trips layout JSON and the theme key", () => {
    const enabled = setFeature(DEFAULT_SHELL, "goals", true);
    const blob = persistable(enabled);
    assert.equal(blob.theme, "default");
    assert.equal(blob.version, 1);
    const again = parseShell(JSON.parse(JSON.stringify(blob)));
    assert.deepEqual(again, blob);
    const empty = parseShell(null);
    assert.equal(empty.enabled.goals, false);
    assert.deepEqual(visibleWidgets(empty), ["money-tiles"]);
    assert.equal(parseShell({ theme: "nocturne", enabled: { goals: true } }).theme, "default");
  });
});
