import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST } from "@/app/api/open-banking/auth-session/route";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "./config";
import { FISKIL_AUTH_SESSION_URL } from "./auth-session";
import { processConnectionStore, type BankConnection } from "./connections";

const previousId = process.env.FISKIL_CLIENT_ID;
const previousSecret = process.env.FISKIL_CLIENT_SECRET;

afterEach(() => {
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousSecret;
});

describe("POST /api/open-banking/auth-session", () => {
  it("returns only sessionId and counts — never the secret, token, or auth_url", async () => {
    process.env.FISKIL_CLIENT_ID = "client-id";
    process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === FISKIL_TOKEN_URL) {
        return new Response(JSON.stringify({ token: "tok_route", expires_in: 900 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith(`${FISKIL_API_BASE}/end-users`) && method === "GET") {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === `${FISKIL_API_BASE}/end-users` && method === "POST") {
        return new Response(JSON.stringify({ end_user_id: "eu_route" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === FISKIL_AUTH_SESSION_URL && method === "POST") {
        return new Response(
          JSON.stringify({
            session_id: "sess_route",
            auth_url: "https://auth.fiskil.com/secret-ish",
            id: "client-looking-id",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as typeof fetch;

    try {
      const response = await POST(
        new Request("http://localhost/api/open-banking/auth-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "user-session-route",
            email: "route@example.com",
            featureToggles: { OPEN_BANKING: true },
            redirectUri: "https://app.example/accounts?open-banking=linked",
            cancelUri: "https://app.example/accounts?open-banking=cancelled",
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["connectionCount", "remaining", "sessionId"]);
      assert.equal(body.sessionId, "sess_route");
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /super-secret-value/);
      assert.doesNotMatch(serialized, /tok_route/);
      assert.doesNotMatch(serialized, /auth_url/);
      assert.doesNotMatch(serialized, /FISKIL_CLIENT_SECRET/);
      assert.doesNotMatch(serialized, /client-looking-id/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 409 with cap copy when the user already has 5 links", async () => {
    process.env.FISKIL_CLIENT_ID = "client-id";
    process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
    const store = processConnectionStore();
    for (let i = 0; i < 5; i += 1) {
      const row: BankConnection = {
        id: `route_cap_${i}`,
        userId: "user-session-cap",
        endUserId: "eu_cap",
        sessionId: `old_${i}`,
        consentId: `route_cap_${i}`,
        status: "active",
        createdAt: "2026-09-19T00:00:00.000Z",
      };
      await store.put(row);
    }

    const response = await POST(
      new Request("http://localhost/api/open-banking/auth-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "user-session-cap",
          email: "cap@example.com",
          featureToggles: { OPEN_BANKING: true },
          redirectUri: "https://app.example/accounts?open-banking=linked",
          cancelUri: "https://app.example/accounts?open-banking=cancelled",
        }),
      }),
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, "CONNECTION_CAP");
    assert.match(String(body.error), /Disconnect one to add another/);
    assert.doesNotMatch(JSON.stringify(body), /super-secret-value/);
  });
});
