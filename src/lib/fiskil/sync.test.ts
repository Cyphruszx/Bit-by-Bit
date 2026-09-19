import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_LEDGER } from "@/lib/money-flow/ledger";
import { FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import { FIRST_SYNC_DAYS, firstSyncFrom } from "./banking";
import { memoryConnectionStore, type BankConnection } from "./connections";
import { memoryEndUserLinkStore } from "./end-users";
import { memoryLedgerDocumentStore } from "./ledger-store";
import {
  handleOpenBankingWebhookEvent,
  isDueForPoll,
  POLL_INTERVAL_MS,
  pollDueOpenBankingConnections,
  syncOpenBankingConnection,
} from "./sync";
import { memoryTokenCache } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type MockCall = { url: string; method: string };

function mockBanking(options?: {
  accounts?: unknown[];
  transactions?: unknown[];
  failStatus?: number;
  tokenFail?: boolean;
}): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (url === FISKIL_TOKEN_URL) {
      if (options?.tokenFail) return jsonResponse({ error: "nope" }, 401);
      return jsonResponse({ token: "tok_app", expires_in: 900 });
    }
    if (options?.failStatus && url.includes("/banking/")) {
      return jsonResponse({ message: "no" }, options.failStatus);
    }
    if (url.includes("/banking/accounts")) {
      return jsonResponse({ accounts: options?.accounts ?? [] });
    }
    if (url.includes("/banking/transactions")) {
      return jsonResponse({ transactions: options?.transactions ?? [] });
    }
    if (url.includes("/banking/balances")) {
      return jsonResponse({ balances: [] });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

function connection(over: Partial<BankConnection> = {}): BankConnection {
  return {
    id: "consent_1",
    userId: "user-1",
    endUserId: "eu_1",
    sessionId: "sess_1",
    consentId: "consent_1",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

async function deps(mocked: ReturnType<typeof mockBanking>, seed?: BankConnection) {
  const connections = memoryConnectionStore();
  const ledgers = memoryLedgerDocumentStore();
  const endUsers = memoryEndUserLinkStore();
  if (seed) await connections.put(seed);
  await endUsers.put({ userId: "user-1", endUserId: "eu_1", email: "sam@example.com" });
  return {
    mocked,
    deps: {
      credentials: CREDENTIALS,
      connections,
      endUsers,
      ledgers,
      cache: memoryTokenCache(),
      fetchImpl: mocked.fetchImpl,
      now: () => Date.parse("2026-09-19T12:00:00.000Z"),
    },
  };
}

describe("Open Banking sync windows", () => {
  it("first connect requests 90 days and incremental uses lastCursor", async () => {
    const accounts = [
      {
        id: "acc_1",
        name: "Everyday",
        account_number: "100200300",
        institution_name: "NAB",
      },
    ];
    const transactions = [
      {
        id: "tx_1",
        account_id: "acc_1",
        amount: -12.5,
        description: "Woolworths",
        status: "POSTED",
        posted: "2026-09-10T00:00:00.000Z",
      },
    ];
    const firstMock = mockBanking({ accounts, transactions });
    const first = await deps(firstMock, connection());
    const started = await syncOpenBankingConnection(
      { connection: connection(), reason: "first_connect" },
      first.deps,
    );
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.firstSync, true);
    const txnCall = firstMock.calls.find((call) => call.url.includes("/banking/transactions"));
    assert.ok(txnCall);
    const firstUrl = new URL(txnCall!.url);
    assert.equal(firstUrl.searchParams.get("from"), firstSyncFrom(Date.parse("2026-09-19T12:00:00.000Z")));
    assert.equal(FIRST_SYNC_DAYS, 90);

    const held = await first.deps.connections.getById("consent_1");
    assert.equal(held?.firstSyncCompletedAt, "2026-09-19T12:00:00.000Z");
    assert.equal(held?.lastCursor, "2026-09-19T12:00:00.000Z");

    const laterMock = mockBanking({ accounts, transactions: [] });
    const second = await syncOpenBankingConnection(
      { connection: (await first.deps.connections.getById("consent_1"))!, reason: "webhook" },
      { ...first.deps, fetchImpl: laterMock.fetchImpl, cache: memoryTokenCache() },
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.firstSync, false);
    const laterCall = laterMock.calls.find((call) => call.url.includes("/banking/transactions"));
    const laterUrl = new URL(laterCall!.url);
    assert.equal(laterUrl.searchParams.get("from"), "2026-09-19T12:00:00.000Z");
    const ninetyAgo = firstSyncFrom(Date.parse("2026-09-19T12:00:00.000Z"));
    assert.notEqual(laterUrl.searchParams.get("from"), ninetyAgo);
  });

  it("polls only when the last sync is older than 4 hours, using the same upsert keys", async () => {
    const now = Date.parse("2026-09-19T12:00:00.000Z");
    assert.equal(isDueForPoll(connection({ lastSyncedAt: "2026-09-19T10:00:00.000Z" }), now), false);
    assert.equal(
      isDueForPoll(connection({ lastSyncedAt: new Date(now - POLL_INTERVAL_MS).toISOString() }), now),
      true,
    );
    assert.equal(isDueForPoll(connection({ status: "needs_reconnect", lastSyncedAt: "2026-01-01T00:00:00.000Z" }), now), false);

    const mocked = mockBanking({
      accounts: [{ id: "acc_1", name: "Everyday", account_number: "100200300", institution_name: "NAB" }],
      transactions: [
        {
          id: "tx_poll",
          account_id: "acc_1",
          amount: -3,
          description: "Bus",
          status: "POSTED",
          posted: "2026-09-18T00:00:00.000Z",
        },
      ],
    });
    const wired = await deps(
      mocked,
      connection({ lastSyncedAt: "2026-09-19T00:00:00.000Z", lastCursor: "2026-09-19T00:00:00.000Z", firstSyncCompletedAt: "2026-09-10T00:00:00.000Z" }),
    );
    const results = await pollDueOpenBankingConnections(wired.deps);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, true);
    const ledger = await wired.deps.ledgers.get("user-1");
    assert.equal(ledger.entries[0]?.externalId, "tx_poll");
    const txnUrl = new URL(mocked.calls.find((call) => call.url.includes("/banking/transactions"))!.url);
    assert.equal(txnUrl.searchParams.get("from"), "2026-09-19T00:00:00.000Z");
  });
});

describe("consent and token failure", () => {
  it("stops sync and marks reconnect without rewriting CLEARED rows", async () => {
    const accounts = [{ id: "acc_1", name: "Everyday", account_number: "100200300", institution_name: "NAB" }];
    const transactions = [
      {
        id: "tx_keep",
        account_id: "acc_1",
        amount: -8,
        description: "Cafe",
        status: "POSTED",
        posted: "2026-09-10T00:00:00.000Z",
      },
    ];
    const good = await deps(mockBanking({ accounts, transactions }), connection());
    const seeded = await syncOpenBankingConnection({ connection: connection(), reason: "first_connect" }, good.deps);
    assert.equal(seeded.ok, true);
    const before = await good.deps.ledgers.get("user-1");
    assert.equal(before.entries[0]?.status, "CLEARED");
    assert.equal(before.entries[0]?.externalId, "tx_keep");

    const failed = mockBanking({ failStatus: 401 });
    const held = (await good.deps.connections.getById("consent_1"))!;
    const result = await syncOpenBankingConnection(
      { connection: held, reason: "webhook" },
      { ...good.deps, fetchImpl: failed.fetchImpl, cache: memoryTokenCache() },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reconnect, true);
    const stopped = await good.deps.connections.getById("consent_1");
    assert.equal(stopped?.status, "needs_reconnect");
    assert.equal(stopped?.syncStoppedReason, "consent");
    const after = await good.deps.ledgers.get("user-1");
    assert.deepEqual(
      after.entries.map((row) => ({ id: row.externalId, status: row.status, amount: row.amount })),
      before.entries.map((row) => ({ id: row.externalId, status: row.status, amount: row.amount })),
    );
  });

  it("token failure also stops sync and skips later polls", async () => {
    const failed = mockBanking({ tokenFail: true });
    const wired = await deps(failed, connection());
    const result = await syncOpenBankingConnection({ connection: connection(), reason: "first_connect" }, wired.deps);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reconnect, true);
    const stopped = await wired.deps.connections.getById("consent_1");
    assert.equal(stopped?.status, "needs_reconnect");
    assert.equal(stopped?.syncStoppedReason, "token");
    assert.equal(isDueForPoll(stopped!, Date.now()), false);
    const ledger = await wired.deps.ledgers.get("user-1");
    assert.deepEqual(ledger.entries, EMPTY_LEDGER.entries);
  });

  it("consent.revoked webhook parks sync without touching the ledger", async () => {
    const good = await deps(
      mockBanking({
        accounts: [{ id: "acc_1", account_number: "100200300", institution_name: "NAB" }],
        transactions: [
          {
            id: "tx_keep",
            account_id: "acc_1",
            amount: -1,
            description: "Keep",
            status: "POSTED",
            posted: "2026-09-01T00:00:00.000Z",
          },
        ],
      }),
      connection(),
    );
    await syncOpenBankingConnection({ connection: connection(), reason: "first_connect" }, good.deps);
    const before = await good.deps.ledgers.get("user-1");
    const handled = await handleOpenBankingWebhookEvent(
      { messageId: "msg_revoked", event: "consent.revoked", consentId: "consent_1", endUserId: "eu_1", accountIds: [] },
      good.deps,
    );
    assert.equal(handled.ok, true);
    const stopped = await good.deps.connections.getById("consent_1");
    assert.equal(stopped?.status, "needs_reconnect");
    const after = await good.deps.ledgers.get("user-1");
    assert.equal(after.entries[0]?.externalId, before.entries[0]?.externalId);
    assert.equal(after.entries[0]?.status, "CLEARED");
  });
});
