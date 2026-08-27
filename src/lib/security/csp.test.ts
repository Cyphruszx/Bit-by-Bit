import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateLimit, resetRateLimits } from "./rate-limit";
import { buildCsp } from "./csp";

describe("rateLimit", () => {
  it("allows up to the limit inside the window", () => {
    resetRateLimits();
    assert.equal(rateLimit("a", 2, 1000, 1000), true);
    assert.equal(rateLimit("a", 2, 1000, 1001), true);
    assert.equal(rateLimit("a", 2, 1000, 1002), false);
    assert.equal(rateLimit("a", 2, 1000, 2001), true);
  });
});

describe("CSP", () => {
  it("uses a nonce for scripts and does not allow unsafe-inline scripts", () => {
    const csp = buildCsp("abc123", "https://example.supabase.co", false);
    assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.match(csp, /connect-src 'self' https:\/\/example.supabase.co/);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});
