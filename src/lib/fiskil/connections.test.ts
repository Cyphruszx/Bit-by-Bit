import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONNECTION_CAP_CODE, CONNECTION_CAP_COPY, MAX_BANK_CONNECTIONS } from "@/lib/open-banking/limits";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import { FISKIL_AUTH_SESSION_URL } from "./auth-session";
import {
  completeOpenBankingConnection,
  listOpenBankingConnections,
  memoryAuthSessionStore,
  memoryConnectionStore,
  parseStartSessionBody,
  reconnectOpenBankingConnection,
  revokeOpenBankingConnection,
  startOpenBankingLinkSession,
  type BankConnection,
} from "./connections";
import { memoryEndUserLinkStore } from "./end-users";
import { memoryTokenCache } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };
const URIS = {
  redirectUri: "https://app.example/accounts?open-banking=linked",
  cancelUri: "https://app.example/accounts?open-banking=cancelled",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type MockCall = { url: string; method: string; body?: unknown; authorization?: string };

function mockFiskil(sessionId = "sess_1"): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, authorization });

    if (url === FISKIL_TOKEN_URL) return jsonResponse({ token: "tok_app", expires_in: 900 });
    if (url.startsWith(`${FISKIL_API_BASE}/end-users`) && method === "GET") return jsonResponse([]);
    if (url === `${FISKIL_API_BASE}/end-users` && method === "POST") {
      return jsonResponse({ end_user_id: "eu_new" });
    }
    if (url === FISKIL_AUTH_SESSION_URL && method === "POST") {
      return jsonResponse({ session_id: sessionId, auth_url: "https://auth.fiskil.com/x", id: "row" });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

function connectDeps(sessionId = "sess_1") {
  const mocked = mockFiskil(sessionId);
  return {
    ...mocked,
    deps: {
      credentials: CREDENTIALS,
      endUsers: memoryEndUserLinkStore(),
      connections: memoryConnectionStore(),
      sessions: memoryAuthSessionStore(),
      cache: memoryTokenCache(),
      fetchImpl: mocked.fetchImpl,
    },
  };
}

async function seedConnections(store: ReturnType<typeof memoryConnectionStore>, userId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const row: BankConnection = {
      id: `consent_${i}`,
      userId,
      endUserId: "eu_new",
      sessionId: `sess_old_${i}`,
      consentId: `consent_${i}`,
      status: "active",
      createdAt: "2026-09-19T00:00:00.000Z",
    };
    await store.put(row);
  }
}

describe("Open Banking link session start", () => {
  it("refuses when the OPEN_BANKING bundle toggle is off", async () => {
    const { deps } = connectDeps();
    const refused = await startOpenBankingLinkSession(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: false }, ...URIS },
      deps,
    );
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);
  });

  it("creates an auth session after ensuring the end user", async () => {
    const { deps, calls } = connectDeps("sess_ok");
    const result = await startOpenBankingLinkSession(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: true }, ...URIS },
      deps,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sessionId, "sess_ok");
    assert.equal(result.connectionCount, 0);
    assert.equal(result.remaining, MAX_BANK_CONNECTIONS);
    assert.equal(
      calls.some((call) => call.method === "POST" && call.url === `${FISKIL_API_BASE}/end-users`),
      true,
    );
    const sessionCall = calls.find((call) => call.url === FISKIL_AUTH_SESSION_URL);
    assert.equal(sessionCall?.authorization, "Bearer tok_app");
    assert.equal((sessionCall?.body as { end_user_id?: string }).end_user_id, "eu_new");
    const stored = await deps.sessions.getBySessionId("sess_ok");
    assert.equal(stored?.userId, "user-1");
    assert.equal(stored?.endUserId, "eu_new");
  });

  it("hard-blocks a 6th connection with the locked copy", async () => {
    const { deps, calls } = connectDeps("sess_blocked");
    await seedConnections(deps.connections, "user-cap", 5);
    const result = await startOpenBankingLinkSession(
      { userId: "user-cap", email: "sam@example.com", featureToggles: { OPEN_BANKING: true }, ...URIS },
      deps,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(result.code, CONNECTION_CAP_CODE);
    assert.match(result.error, /Disconnect one to add another/);
    assert.equal(result.error.includes(CONNECTION_CAP_COPY), true);
    assert.equal(result.connectionCount, 5);
    assert.equal(
      calls.some((call) => call.url === FISKIL_AUTH_SESSION_URL),
      false,
    );
  });

  it("does not count revoked links toward the cap", async () => {
    const { deps } = connectDeps("sess_after_revoke");
    await seedConnections(deps.connections, "user-rev", 5);
    const fifth = await deps.connections.getById("consent_4");
    assert.ok(fifth);
    await deps.connections.put({ ...fifth, status: "revoked", revokedAt: "2026-09-19T01:00:00.000Z" });
    const result = await startOpenBankingLinkSession(
      { userId: "user-rev", email: "sam@example.com", featureToggles: { OPEN_BANKING: true }, ...URIS },
      deps,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sessionId, "sess_after_revoke");
    assert.equal(result.connectionCount, 4);
  });

  it("parses the start body without accepting Fiskil secrets", () => {
    const parsed = parseStartSessionBody({
      userId: "user-1",
      email: "sam@example.com",
      featureToggles: { OPEN_BANKING: true },
      redirectUri: URIS.redirectUri,
      cancelUri: URIS.cancelUri,
      FISKIL_CLIENT_SECRET: "nope",
      client_secret: "nope",
    });
    assert.deepEqual(parsed, {
      userId: "user-1",
      email: "sam@example.com",
      featureToggles: { OPEN_BANKING: true },
      ...URIS,
    });
  });
});

describe("Open Banking connection complete / stubs", () => {
  it("records a consent against the stored session", async () => {
    const { deps } = connectDeps("sess_done");
    const started = await startOpenBankingLinkSession(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: true }, ...URIS },
      deps,
    );
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const completed = await completeOpenBankingConnection(
      {
        userId: "user-1",
        sessionId: started.sessionId,
        consentId: "consent_live",
        featureToggles: { OPEN_BANKING: true },
      },
      deps,
    );
    assert.equal(completed.ok, true);
    if (!completed.ok) return;
    assert.equal(completed.connection.id, "consent_live");
    assert.equal(completed.connectionCount, 1);
    const listed = await listOpenBankingConnections({ userId: "user-1" }, deps);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.connections.length, 1);
    assert.equal("consentId" in listed.connections[0]!, false);
  });

  it("revokes a connection so another bank can be added", async () => {
    const { deps } = connectDeps("sess_rev");
    await seedConnections(deps.connections, "user-1", 5);
    const revoked = await revokeOpenBankingConnection(
      { userId: "user-1", connectionId: "consent_0", featureToggles: { OPEN_BANKING: true } },
      deps,
    );
    assert.equal(revoked.ok, true);
    if (!revoked.ok) return;
    assert.equal(revoked.connection.status, "revoked");
    assert.equal(revoked.connectionCount, 4);
    const started = await startOpenBankingLinkSession(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: true }, ...URIS },
      deps,
    );
    assert.equal(started.ok, true);
  });

  it("reconnect stub mints a new session without adding a 6th link", async () => {
    const { deps } = connectDeps("sess_re");
    await seedConnections(deps.connections, "user-1", 5);
    const reconnected = await reconnectOpenBankingConnection(
      {
        userId: "user-1",
        email: "sam@example.com",
        connectionId: "consent_1",
        featureToggles: { OPEN_BANKING: true },
        ...URIS,
      },
      deps,
    );
    assert.equal(reconnected.ok, true);
    if (!reconnected.ok) return;
    assert.equal(reconnected.sessionId, "sess_re");
    assert.equal(reconnected.connectionCount, 4);
    const held = await deps.connections.getById("consent_1");
    assert.equal(held?.status, "needs_reconnect");
  });
});
