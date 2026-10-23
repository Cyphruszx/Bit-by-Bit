import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const nav = readFileSync(new URL("./app-nav.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("./mobile-nav.tsx", import.meta.url), "utf8");

describe("desktop sidebar", () => {
  it("lists Categories between Transactions and Budget, with no New badge", () => {
    assert.match(
      nav,
      /\["Dashboard", "\/dashboard"\],\s*\["Transactions", "\/transactions"\],\s*\["Categories", "\/categories"\],\s*\["Budget", "\/budgeting"\]/,
    );
    assert.doesNotMatch(nav, /NEW/);
    assert.doesNotMatch(nav, /\bNew\b/);
  });
});

describe("mobile nav", () => {
  it("keeps the existing labels, including Categories", () => {
    assert.match(
      mobile,
      /\["Home", "\/dashboard"\],\s*\["Ledger", "\/transactions"\],\s*\["Categories", "\/categories"\],\s*\["Budget", "\/budgeting"\],\s*\["Review", "\/review"\],\s*\["Settings", "\/settings"\]/,
    );
  });
});
