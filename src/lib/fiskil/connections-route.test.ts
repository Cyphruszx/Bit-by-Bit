import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET, POST } from "@/app/api/open-banking/connections/route";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "./config";
import { processAuthSessionStore, processConnectionStore } from "./connections";
import { processLedgerDocumentStore } from "./ledger-store";
import { SANDBOX_ACCOUNT, SANDBOX_TRANSACTION } from "./sandbox-shapes";

const previousId = process.env.FISKIL_CLIENT_ID;
const previousSecret = process.env.FISKIL_CLIENT_SECRET;
const previousFetch = globalThis.fetch;

afterEach(() => {
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
    const response = await GET(new Request("http://localhost/api/open-banking/connections?userId=user-list"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { connections: Record<string, unknown>[] };
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
    const response = await POST(
      new Request("http://localhost/api/open-banking/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          userId: "user-complete",
          sessionId: "sess_complete",
          consentId: "consent_complete",
          featureToggles: { OPEN_BANKING: true },
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

    const response = await POST(
      new Request("http://localhost/api/open-banking/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          userId: "user-sync",
          sessionId: "sess_sync",
          consentId: "consent_sync",
          featureToggles: { OPEN_BANKING: true },
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
