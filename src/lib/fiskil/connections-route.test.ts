import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET, POST } from "@/app/api/open-banking/connections/route";
import { installTestSession, setSessionVerifierForTests, testSessionHeaders } from "@/lib/auth/request-session";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "./config";
import { processAuthSessionStore, processConnectionStore } from "./connections";
import { processLedgerDocumentStore } from "./ledger-store";
import { SANDBOX_ACCOUNT, SANDBOX_TRANSACTION } from "./sandbox-shapes";

const previousId = process.env.FISKIL_CLIENT_ID;
const previousSecret = process.env.FISKIL_CLIENT_SECRET;
const previousFetch = globalThis.fetch;

afterEach(() => {
  setSessionVerifierForTests(undefined);
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousSecret;
  globalThis.fetch = previousFetch;
});

describe("Open Banking connections route", () => {
  it("lists public connection fields only", async () => {
    await processConnectionStore().put({
      id: "consent_list",
      userId: "user-list",
      endUserId: "eu_hidden",
      sessionId: "sess_hidden",
      consentId: "consent_list",
      status: "active",
      createdAt: "2026-09-19T00:00:00.000Z",
    });
    await processConnectionStore().put({
      id: "consent_other",
      userId: "someone-else",
      endUserId: "eu_other",
      sessionId: "sess_other",
      consentId: "consent_other",
      status: "active",
      createdAt: "2026-09-19T00:00:00.000Z",
    });
    installTestSession({ userId: "user-list", email: "list@example.com" });
    const response = await GET(new Request("http://localhost/api/open-banking/connections?userId=someone-else", {
      headers: testSessionHeaders("user-list"),
    }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { connections: { id: string }[] };
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0]?.id, "consent_list");
    assert.deepEqual(Object.keys(body.connections[0]!).sort(), ["createdAt", "id", "status"]);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /eu_hidden/);
    assert.doesNotMatch(serialized, /sess_hidden/);
    assert.doesNotMatch(serialized, /FISKIL_CLIENT_SECRET/);
  });

  it("completes a stored session without echoing secrets", async () => {
    process.env.FISKIL_CLIENT_ID = "client-id";
    process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
    globalThis.fetch = (async () => {
      throw new Error("first-sync fetch is mocked in this route test");
    }) as typeof fetch;
    await processAuthSessionStore().put({
      sessionId: "sess_complete",
      userId: "user-complete",
      endUserId: "eu_complete",
      redirectUri: "https://app.example/accounts?open-banking=linked",
      cancelUri: "https://app.example/accounts?open-banking=cancelled",
      createdAt: "2026-09-19T00:00:00.000Z",
    });
    installTestSession({ userId: "user-complete", email: "complete@example.com" });
    const response = await POST(
      new Request("http://localhost/api/open-banking/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testSessionHeaders("user-complete") },
        body: JSON.stringify({
          action: "complete",
          userId: "someone-else",
          sessionId: "sess_complete",
          consentId: "consent_complete",
          featureToggles: { OPEN_BANKING: false },
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal((body.connection as { id: string }).id, "consent_complete");
    assert.doesNotMatch(JSON.stringify(body), /super-secret-value/);
    assert.doesNotMatch(JSON.stringify(body), /eu_complete/);
    assert.equal((body.sync as { started?: boolean })?.started, true);
  });

  it("awaits first sync on complete and writes the durable ledger the UI would see", async () => {
    process.env.FISKIL_CLIENT_ID = "client-id";
    process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === FISKIL_TOKEN_URL) {
        return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`${FISKIL_API_BASE}/banking/accounts`)) {
        return new Response(JSON.stringify({ accounts: [SANDBOX_ACCOUNT] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`${FISKIL_API_BASE}/banking/transactions`)) {
        return new Response(JSON.stringify({ transactions: [SANDBOX_TRANSACTION] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`${FISKIL_API_BASE}/banking/balances`)) {
        return new Response(JSON.stringify({ balances: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    await processAuthSessionStore().put({
      sessionId: "sess_sync",
      userId: "user-sync",
      endUserId: "eu_sync",
      redirectUri: "https://app.example/accounts?open-banking=linked",
      cancelUri: "https://app.example/accounts?open-banking=cancelled",
      createdAt: "2026-09-19T00:00:00.000Z",
    });

    installTestSession({ userId: "user-sync", email: "sync@example.com" });
    const response = await POST(
      new Request("http://localhost/api/open-banking/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testSessionHeaders("user-sync") },
        body: JSON.stringify({
          action: "complete",
          userId: "someone-else",
          sessionId: "sess_sync",
          consentId: "consent_sync",
          featureToggles: { OPEN_BANKING: false },
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      connection: { id: string };
      sync?: { started?: boolean; ok?: boolean };
      ledger?: { entries?: { externalId?: string }[] };
    };
    assert.equal(body.connection.id, "consent_sync");
    assert.equal(body.sync?.started, true);
    assert.equal(body.sync?.ok, true);
    assert.equal(body.ledger?.entries?.some((row) => row.externalId === "txn_sandbox_coffee"), true);
    const stored = await processLedgerDocumentStore().get("user-sync");
    assert.equal(stored.entries.some((row) => row.externalId === "txn_sandbox_coffee"), true);
    assert.doesNotMatch(JSON.stringify(body), /super-secret-value/);
  });
});
