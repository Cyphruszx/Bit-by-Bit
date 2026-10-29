import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST as startSession } from "@/app/api/open-banking/auth-session/route";
import { GET as listConnections, POST as changeConnection } from "@/app/api/open-banking/connections/route";
import { DELETE as deleteEndUser, POST as provisionEndUser } from "@/app/api/open-banking/end-user/route";
import { POST as syncNow } from "@/app/api/open-banking/sync/route";
import {
  installTestSession,
  setSessionVerifierForTests,
  testSessionHeaders,
} from "@/lib/auth/request-session";
import { processConnectionStore } from "@/lib/fiskil/connections";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "@/lib/fiskil/config";
import { processLedgerDocumentStore } from "@/lib/fiskil/ledger-store";
import { EMPTY_LEDGER } from "@/lib/money-flow/ledger";
import { SANDBOX_ACCOUNT, SANDBOX_TRANSACTION } from "@/lib/fiskil/sandbox-shapes";

const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const previousId = process.env.FISKIL_CLIENT_ID;
const previousSecret = process.env.FISKIL_CLIENT_SECRET;
const previousFetch = globalThis.fetch;

afterEach(() => {
  setSessionVerifierForTests(undefined);
  if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousSecret;
  globalThis.fetch = previousFetch;
});

describe("Open Banking user routes require the Supabase session", { concurrency: 1 }, () => {
  it("returns 401 when nobody is signed in", async () => {
    const bodies = [
      await syncNow(jsonRequest("/api/open-banking/sync", { userId: "user-a", connectionId: "c", featureToggles: { OPEN_BANKING: true } })),
      await startSession(jsonRequest("/api/open-banking/auth-session", { userId: "user-a", email: "a@example.com" })),
      await provisionEndUser(jsonRequest("/api/open-banking/end-user", { userId: "user-a", email: "a@example.com" })),
      await deleteEndUser(jsonRequest("/api/open-banking/end-user", { userId: "user-a" }, "DELETE")),
      await listConnections(new Request("http://localhost/api/open-banking/connections?userId=user-a")),
      await changeConnection(jsonRequest("/api/open-banking/connections", { action: "revoke", userId: "user-a", connectionId: "c" })),
    ];
    for (const response of bodies) {
      assert.equal(response.status, 401);
      const body = (await response.json()) as { error?: string };
      assert.equal(body.error, "Unauthorized.");
    }
  });

  it("returns 404 for another user's connection and ignores a spoofed userId", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetches = armFetch();
    installTestSession({ userId: "user-a", email: "a@example.com" });
    await processConnectionStore().put({
      id: "consent_b",
      userId: "user-b",
      endUserId: "eu_b",
      sessionId: "sess_b",
      consentId: "consent_b",
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const response = await syncNow(jsonRequest("/api/open-banking/sync", {
      userId: "user-b",
      connectionId: "consent_b",
      featureToggles: { OPEN_BANKING: true },
    }, "POST", testSessionHeaders("user-a")));
    assert.equal(response.status, 404);
    assert.equal(fetches(), 0);
  });

  it("ignores a client paid flag when the stored ledger has Open Banking off", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetches = armFetch();
    installTestSession({ userId: "user-off", email: "off@example.com" });
    await processLedgerDocumentStore().put("user-off", {
      ...EMPTY_LEDGER,
      featureToggles: { OPEN_BANKING: false },
    });
    await processConnectionStore().put({
      id: "consent_off",
      userId: "user-off",
      endUserId: "eu_off",
      sessionId: "sess_off",
      consentId: "consent_off",
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const response = await syncNow(jsonRequest("/api/open-banking/sync", {
      userId: "user-off",
      connectionId: "consent_off",
      featureToggles: { OPEN_BANKING: true },
    }, "POST", testSessionHeaders("user-off")));
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string };
    assert.match(body.error ?? "", /Open Banking Bundle/);
    assert.equal(fetches(), 0);
  });

  it("verifies the access token from the Supabase auth cookie", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let seen: string | null = null;
    setSessionVerifierForTests(async (token) => {
      seen = token;
      return { userId: "user-cookie", email: "cookie@example.com" };
    });
    const encoded = `base64-${Buffer.from(JSON.stringify({ access_token: "cookie-token" }), "utf8").toString("base64url")}`;
    const response = await listConnections(new Request("http://localhost/api/open-banking/connections?userId=someone-else", {
      headers: { cookie: `sb-proj-auth-token=${encoded}` },
    }));
    assert.equal(response.status, 200);
    assert.equal(seen, "cookie-token");
    const body = (await response.json()) as { connections: unknown[] };
    assert.deepEqual(body.connections, []);
  });
});

function jsonRequest(
  path: string,
  body: unknown,
  method = "POST",
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function armFetch(): () => number {
  process.env.FISKIL_CLIENT_ID = "client-id";
  process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (url === FISKIL_TOKEN_URL) {
      return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), { status: 200 });
    }
    if (url.includes(`${FISKIL_API_BASE}/banking/`)) {
      const accounts = url.includes("/accounts");
      const transactions = url.includes("/transactions");
      return new Response(JSON.stringify({
        ...(accounts ? { accounts: [SANDBOX_ACCOUNT] } : {}),
        ...(transactions ? { transactions: [SANDBOX_TRANSACTION] } : {}),
        balances: [],
      }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return () => calls;
}
