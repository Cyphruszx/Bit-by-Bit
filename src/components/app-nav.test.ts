import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const nav = readFileSync(new URL("./app-nav.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("./mobile-nav.tsx", import.meta.url), "utf8");

describe("desktop sidebar", () => {
  it("lists Review beside Transactions, then Categories and Budget", () => {
    assert.match(
      nav,
      /\["Dashboard", "\/dashboard"\],\s*\["Transactions", "\/transactions"\],\s*\["Review", "\/review"\],\s*\["Categories", "\/categories"\],\s*\["Budget", "\/budgeting"\]/,
    );
    assert.match(nav, /openReviewCount/);
    assert.match(nav, /aria-current=\{active \? "page" : undefined\}/);
    assert.doesNotMatch(nav, /NEW/);
    assert.doesNotMatch(nav, /\bNew\b/);
    assert.doesNotMatch(nav, /text-negative|bg-attention|text-attention|orange|#f[0-9a-f]{2}[0-4]/i);
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
