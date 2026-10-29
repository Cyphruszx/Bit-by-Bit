import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessTokenFromRequest } from "./request-session";

describe("Open Banking session token", () => {
  it("reads a bearer access token", () => {
    const request = new Request("http://localhost/api/open-banking/sync", {
      headers: { Authorization: "Bearer access-from-header" },
    });
    assert.equal(accessTokenFromRequest(request), "access-from-header");
  });

  it("prefers Authorization over a Supabase auth cookie", () => {
    const cookie = supabaseAuthCookie("sb-proj-auth-token", "access-from-cookie");
    const request = new Request("http://localhost/api/open-banking/connections", {
      headers: {
        Authorization: "Bearer access-from-header",
        cookie,
      },
    });
    assert.equal(accessTokenFromRequest(request), "access-from-header");
  });

  it("reads a base64 Supabase auth cookie, including chunks", () => {
    const encoded = `base64-${Buffer.from(JSON.stringify({ access_token: "access-from-cookie" }), "utf8").toString("base64url")}`;
    const mid = Math.floor(encoded.length / 2);
    const request = new Request("http://localhost/api/open-banking/connections", {
      headers: {
        cookie: `sb-proj-auth-token.0=${encoded.slice(0, mid)}; sb-proj-auth-token.1=${encoded.slice(mid)}`,
      },
    });
    assert.equal(accessTokenFromRequest(request), "access-from-cookie");
  });

  it("returns nothing when the request has no session", () => {
    const request = new Request("http://localhost/api/open-banking/connections");
    assert.equal(accessTokenFromRequest(request), null);
  });
});

function supabaseAuthCookie(name: string, accessToken: string): string {
  const encoded = `base64-${Buffer.from(JSON.stringify({ access_token: accessToken }), "utf8").toString("base64url")}`;
  return `${name}=${encoded}`;
}
