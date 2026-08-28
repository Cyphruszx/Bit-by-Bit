import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOriginMatches,
  clientIpFromHeaders,
  originForEmailRedirect,
  publicAppOrigin,
  trustedAppOrigins,
} from "./origin";

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
  it("uses NEXT_PUBLIC_SITE_URL and ignores Origin / X-Forwarded-Host / VERCEL_URL", () => {
    assert.equal(
      publicAppOrigin(
        {
          NEXT_PUBLIC_SITE_URL: "https://bitbybit.example/",
          VERCEL_URL: "bitbybit-abc123.vercel.app",
        },
        headers({
          origin: "https://evil.test",
          "x-forwarded-host": "evil.test",
          host: "evil.test",
        }),
      ),
      "https://bitbybit.example",
    );
  });

  it("prefers the stable production host over the per-deployment VERCEL_URL", () => {
    assert.equal(
      publicAppOrigin({
        VERCEL_URL: "bitbybit-git-main-user.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "bitbybit.example",
      }),
      "https://bitbybit.example",
    );
    assert.equal(publicAppOrigin({ VERCEL_URL: "bitbybit-abc123.vercel.app" }), null);
    assert.equal(publicAppOrigin({}, headers({ host: "localhost:3000" })), "http://localhost:3000");
    assert.equal(publicAppOrigin({}, headers({ host: "localhost.evil.test" })), null);
    assert.equal(publicAppOrigin({}, headers({ "x-forwarded-host": "evil.test", host: "app.example" })), null);
  });
});

describe("trustedAppOrigins", () => {
  it("allows the custom domain and this deployment, not an attacker host", () => {
    const trusted = trustedAppOrigins({
      NEXT_PUBLIC_SITE_URL: "https://bitbybit.example",
      VERCEL_URL: "bitbybit-abc123.vercel.app",
    });
    assert.deepEqual(trusted, ["https://bitbybit.example", "https://bitbybit-abc123.vercel.app"]);
  });
});

describe("originForEmailRedirect", () => {
  it("returns the browser origin when it is on the trusted list", () => {
    const env = {
      NEXT_PUBLIC_SITE_URL: "https://bitbybit.example",
      VERCEL_URL: "bitbybit-abc123.vercel.app",
    };
    assert.equal(originForEmailRedirect("https://bitbybit.example", env), "https://bitbybit.example");
    assert.equal(originForEmailRedirect("https://bitbybit-abc123.vercel.app", env), "https://bitbybit-abc123.vercel.app");
    assert.equal(originForEmailRedirect("https://evil.test", env), "https://bitbybit.example");
  });
});

describe("assertOriginMatches", () => {
  it("rejects missing, mismatched, or attacker-controlled origins", () => {
    const trusted = ["https://bitbybit.example", "https://bitbybit-abc123.vercel.app"];
    assert.throws(() => assertOriginMatches(null, trusted));
    assert.throws(() => assertOriginMatches("https://evil.test", trusted));
    assert.throws(() => assertOriginMatches("https://bitbybit.example", []));
    assert.doesNotThrow(() => assertOriginMatches("https://bitbybit.example", trusted));
    assert.doesNotThrow(() => assertOriginMatches("https://bitbybit-abc123.vercel.app", trusted));
  });
});
