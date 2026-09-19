import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FISKIL_SCOPES, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import { getFiskilAppToken, memoryTokenCache, parseTokenResponse, tokenStillValid } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Fiskil app token obtain and refresh", () => {
  it("POSTs client credentials to /v1/token with the locked scopes", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const token = await getFiskilAppToken({
      credentials: CREDENTIALS,
      cache: memoryTokenCache(),
      now: () => 1_000_000,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse({ token: "tok_live", token_type: "Bearer", expires_in: 900 });
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, FISKIL_TOKEN_URL);
    assert.equal(calls[0]?.init.method, "POST");
    const sent = JSON.parse(String(calls[0]?.init.body)) as Record<string, string>;
    assert.equal(sent.client_id, "client-id");
    assert.equal(sent.client_secret, "super-secret-value");
    assert.equal(sent.grant_type, "client_credentials");
    assert.equal(sent.scope, FISKIL_SCOPES.join(" "));
    assert.equal(token.accessToken, "tok_live");
    assert.equal(token.expiresIn, 900);
    assert.equal(token.expiresAtMs, 1_000_000 + 900_000);
    assert.equal("clientSecret" in token, false);
  });

  it("accepts access_token when Fiskil uses that field name", () => {
    const token = parseTokenResponse({ access_token: "tok_alt", expires_in: "600" }, 0);
    assert.equal(token.accessToken, "tok_alt");
    assert.equal(token.expiresIn, 600);
    assert.equal(token.tokenType, "Bearer");
  });

  it("reuses a cached token inside the TTL", async () => {
    let fetches = 0;
    const cache = memoryTokenCache();
    let now = 0;
    const deps = {
      credentials: CREDENTIALS,
      cache,
      now: () => now,
      fetchImpl: async () => {
        fetches += 1;
        return jsonResponse({ token: `tok_${fetches}`, expires_in: 900 });
      },
    };

    const first = await getFiskilAppToken(deps);
    now = 100_000;
    const second = await getFiskilAppToken(deps);
    assert.equal(fetches, 1);
    assert.equal(first.accessToken, "tok_1");
    assert.equal(second.accessToken, "tok_1");
  });

  it("refreshes when the token is inside the skew window or expired", async () => {
    let fetches = 0;
    const cache = memoryTokenCache();
    let now = 0;
    const deps = {
      credentials: CREDENTIALS,
      cache,
      now: () => now,
      fetchImpl: async () => {
        fetches += 1;
        return jsonResponse({ token: `tok_${fetches}`, expires_in: 900 });
      },
    };

    await getFiskilAppToken(deps);
    now = 840_000; // 60s of 900s left — refresh skew
    const refreshed = await getFiskilAppToken(deps);
    assert.equal(fetches, 2);
    assert.equal(refreshed.accessToken, "tok_2");

    now = 840_000 + 900_000 + 1;
    const expired = await getFiskilAppToken(deps);
    assert.equal(fetches, 3);
    assert.equal(expired.accessToken, "tok_3");
  });

  it("does not treat a token as valid once the skew window starts", () => {
    const token = parseTokenResponse({ token: "tok", expires_in: 900 }, 0);
    assert.equal(tokenStillValid(token, 0), true);
    assert.equal(tokenStillValid(token, 839_000), true);
    assert.equal(tokenStillValid(token, 840_000), false);
    assert.equal(tokenStillValid(token, 901_000), false);
  });

  it("fails without putting the client secret in the error", async () => {
    await assert.rejects(
      () =>
        getFiskilAppToken({
          credentials: CREDENTIALS,
          cache: memoryTokenCache(),
          fetchImpl: async () => jsonResponse({ error: "nope" }, 401),
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /401/);
        assert.doesNotMatch(message, /super-secret-value/);
        return true;
      },
    );
  });
});
