import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST } from "@/app/api/open-banking/end-user/route";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "./config";

const previousId = process.env.FISKIL_CLIENT_ID;
const previousSecret = process.env.FISKIL_CLIENT_SECRET;

afterEach(() => {
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousSecret;
});

describe("POST /api/open-banking/end-user", () => {
  it("returns only the mapping and never the secret or access token", async () => {
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
      throw new Error(`unexpected ${method} ${url}`);
    }) as typeof fetch;

    try {
      const response = await POST(
        new Request("http://localhost/api/open-banking/end-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: "user-route",
            email: "route@example.com",
            featureToggles: { OPEN_BANKING: true },
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["created", "endUserId", "userId"]);
      assert.equal(body.endUserId, "eu_route");
      assert.equal(body.userId, "user-route");
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /super-secret-value/);
      assert.doesNotMatch(serialized, /tok_route/);
      assert.doesNotMatch(serialized, /FISKIL_CLIENT_SECRET/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
