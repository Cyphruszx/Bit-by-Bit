import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("landing page", () => {
  it("uses the split-hero copy and the demo route", () => {
    assert.match(source, /Know what&apos;s left to spend\./);
    assert.match(source, /Or try it with a bank CSV/);
    assert.equal(source.match(/Try Demo mode/g)?.length, 4);
    assert.match(source, />\s*Demo mode\s*</);
    assert.doesNotMatch(source, /min-w-\[32rem\]/);
    assert.doesNotMatch(source, /overflow-x-auto/);
    assert.equal(source.match(/href="\/sign-in"/g)?.length, 4);
    assert.equal(source.match(/href="\/dashboard"/g)?.length, 5);
    assert.doesNotMatch(source, /Guest mode/);
    assert.doesNotMatch(source, /guest/i);
  });

  it("keeps bank connection as coming soon only", () => {
    assert.equal(source.match(/Open Banking/g)?.length, 1);
    assert.match(source, /Bank connection with Open Banking is coming soon/);
    assert.doesNotMatch(source, /connect your bank/i);
    assert.doesNotMatch(source, /Fiskil/);
    assert.doesNotMatch(source, /\bPDF\b/i);
    assert.doesNotMatch(source, /\bAI\b/);
    assert.doesNotMatch(source, /browser/i);
    assert.doesNotMatch(source, /device/i);
  });

  it("labels the sample budget the way the Budget page reads", () => {
    assert.match(source, /Sample data/);
    assert.match(source, /planned=\{4770\} spent=\{4409\}/);
    assert.match(source, /planned=\{2100\} spent=\{2085\}/);
    assert.match(source, /\{formatAud\(category\.spent\)\} spent/);
    assert.doesNotMatch(source, /\$15\.00 over/);
    assert.doesNotMatch(source, /· left/);
    assert.match(source, /gap-4/);
    assert.match(source, /lg:col-span-2/);
    assert.match(source, /lg:col-span-3/);
    assert.doesNotMatch(source, /text-negative|text-attention|bg-attention|#ff|#f8e8e6|#8a2b2b/i);
  });
});
