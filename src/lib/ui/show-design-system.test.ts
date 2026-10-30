import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { BudgetEmptyState } from "@/app/(app)/budgeting/budgeting-view";
import { showDesignSystem } from "./show-design-system";

describe("design system link", () => {
  it("is hidden in production and shown while developing", () => {
    assert.equal(showDesignSystem("production"), false);
    assert.equal(showDesignSystem("development"), true);
    assert.equal(showDesignSystem("test"), true);
  });
});

describe("Budget empty state", () => {
  it("tells a person to add a statement before planning", () => {
    const html = renderToStaticMarkup(createElement(BudgetEmptyState));
    assert.match(html, /Budget/);
    assert.match(html, /No statements yet/);
    assert.match(html, /A budget starts once a statement is in/);
    assert.match(html, /Upload a statement/);
    assert.doesNotMatch(html, /Left to spend/);
  });
});
