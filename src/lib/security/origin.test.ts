import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertOriginMatches, clientIpFromHeaders, publicAppOrigin } from "./origin";

function headers(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

describe("clientIpFromHeaders", () => {
  it("prefers platform-set client IPs over spoofable X-Forwarded-For", () => {
    assert.equal(
      clientIpFromHeaders(
        headers({
          "x-forwarded-for": "9.9.9.9, 1.2.3.4",
          "x-vercel-forwarded-for": "1.2.3.4",
        }),
      ),
      "1.2.3.4",
    );
  });

  it("uses the last X-Forwarded-For hop when no platform header is present", () => {
    assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.2" })), "10.0.0.2");
  });
});

describe("publicAppOrigin", () => {
  it("uses NEXT_PUBLIC_SITE_URL and ignores Origin / X-Forwarded-Host", () => {
    assert.equal(
      publicAppOrigin(
        { NEXT_PUBLIC_SITE_URL: "https://bitbybit.example/" },
        headers({
          origin: "https://evil.test",
          "x-forwarded-host": "evil.test",
          host: "evil.test",
        }),
      ),
      "https://bitbybit.example",
    );
  });

  it("falls back to VERCEL_URL, then loopback Host only", () => {
    assert.equal(publicAppOrigin({ VERCEL_URL: "bitbybit-git-main.vercel.app" }), "https://bitbybit-git-main.vercel.app");
    assert.equal(publicAppOrigin({}, headers({ host: "localhost:3000" })), "http://localhost:3000");
    assert.equal(publicAppOrigin({}, headers({ host: "localhost.evil.test", origin: "https://localhost.evil.test" })), null);
    assert.equal(publicAppOrigin({}, headers({ "x-forwarded-host": "evil.test", host: "app.example" })), null);
  });
});

describe("assertOriginMatches", () => {
  it("rejects missing, mismatched, or attacker-controlled origins", () => {
    assert.throws(() => assertOriginMatches(null, "https://bitbybit.example"));
    assert.throws(() => assertOriginMatches("https://evil.test", "https://bitbybit.example"));
    assert.throws(() => assertOriginMatches("https://bitbybit.example", null));
    assert.doesNotThrow(() => assertOriginMatches("https://bitbybit.example", "https://bitbybit.example"));
  });
});
