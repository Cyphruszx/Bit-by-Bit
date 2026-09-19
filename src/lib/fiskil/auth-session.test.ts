import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import { createFiskilAuthSession, FISKIL_AUTH_SESSION_URL, parseAuthSessionResponse } from "./auth-session";
import { memoryTokenCache } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Fiskil auth session create", () => {
  it("POSTs Bearer app token + end_user_id + redirect/cancel URIs", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown; authorization?: string }> = [];
    const session = await createFiskilAuthSession(
      {
        endUserId: "eu_1",
        redirectUri: "https://app.example/accounts?open-banking=linked",
        cancelUri: "https://app.example/accounts?open-banking=cancelled",
      },
      {
        credentials: CREDENTIALS,
        cache: memoryTokenCache(),
        fetchImpl: async (input, init) => {
          const url = String(input);
          const method = (init?.method ?? "GET").toUpperCase();
          const authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          calls.push({ url, method, body, authorization });
          if (url === FISKIL_TOKEN_URL) {
            return jsonResponse({ token: "tok_app", expires_in: 900 });
          }
          if (url === FISKIL_AUTH_SESSION_URL) {
            return jsonResponse({
              id: "fiskil_session_row",
              session_id: "sess_live",
              auth_url: "https://auth.fiskil.com/consent?session=sess_live",
              expires_at: 1_621_083_785,
            });
          }
          throw new Error(`unexpected ${method} ${url}`);
        },
      },
    );

    assert.equal(session.sessionId, "sess_live");
    assert.equal(session.authUrl, "https://auth.fiskil.com/consent?session=sess_live");
    const sessionCall = calls.find((call) => call.url === FISKIL_AUTH_SESSION_URL);
    assert.ok(sessionCall);
    assert.equal(sessionCall?.method, "POST");
    assert.equal(sessionCall?.authorization, "Bearer tok_app");
    assert.deepEqual(sessionCall?.body, {
      end_user_id: "eu_1",
      redirect_uri: "https://app.example/accounts?open-banking=linked",
      cancel_uri: "https://app.example/accounts?open-banking=cancelled",
    });
    assert.equal(JSON.stringify(sessionCall?.body).includes("super-secret-value"), false);
    assert.equal(
      calls.some((call) => call.url === FISKIL_TOKEN_URL && JSON.stringify(call.body).includes("super-secret-value")),
      true,
    );
    assert.equal(FISKIL_AUTH_SESSION_URL, `${FISKIL_API_BASE}/auth/session`);
  });

  it("reads session_id from the Fiskil envelope", () => {
    const parsed = parseAuthSessionResponse({ session_id: "sess_alt", expires_at: "1621083785" });
    assert.equal(parsed.sessionId, "sess_alt");
    assert.equal(parsed.expiresAt, 1_621_083_785);
  });
});
