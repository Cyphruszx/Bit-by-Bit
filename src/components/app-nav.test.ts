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
  it("uses the desktop names, fewer of them, with a 44px tap target", () => {
    assert.match(mobile, /primaryLinks/);
    assert.match(mobile, /min-h-11 min-w-11/);
    assert.doesNotMatch(mobile, /"Home"|\"Ledger\"/);
    assert.doesNotMatch(mobile, /\/settings/);
    const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
    assert.match(shell, /href="\/settings"/);
    assert.match(shell, /min-h-11 min-w-11/);
    assert.match(shell, />\s*Settings\s*</);
  });
});
