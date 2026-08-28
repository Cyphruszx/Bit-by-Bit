import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeInternalPath } from "./redirect";

describe("safeInternalPath", () => {
  it("keeps same-origin paths and query strings", () => {
    assert.equal(safeInternalPath("/dashboard"), "/dashboard");
    assert.equal(safeInternalPath("/transactions?month=2026-08"), "/transactions?month=2026-08");
    assert.equal(safeInternalPath("/savings#pots"), "/savings#pots");
  });

  it("rejects open redirects that start with a slash", () => {
    assert.equal(new URL("/\\evil.com", "https://example.com").origin, "https://evil.com");
    assert.equal(safeInternalPath("/\\evil.com"), "/dashboard");
    assert.equal(safeInternalPath("//evil.com"), "/dashboard");
    assert.equal(safeInternalPath("///evil.com"), "/dashboard");
    assert.equal(safeInternalPath("/%5cevil.com"), "/dashboard");
    assert.equal(safeInternalPath("/%5Cevil.com"), "/dashboard");
    assert.equal(safeInternalPath("https://evil.com"), "/dashboard");
    assert.equal(safeInternalPath("https://evil.com/phish"), "/dashboard");
    assert.equal(safeInternalPath("/\\t.example"), "/dashboard");
  });

  it("falls back when next is missing or empty", () => {
    assert.equal(safeInternalPath(null), "/dashboard");
    assert.equal(safeInternalPath(""), "/dashboard");
    assert.equal(safeInternalPath("   "), "/dashboard");
  });
});
