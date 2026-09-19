/**
 * Open Banking sync job (Spec 12 Slice 3).
 *
 * First connect pulls 90 days once. Later webhooks/polls use lastCursor.
 * Consent/token failure stops sync and marks reconnect — CLEARED rows stay.
 */

import { hasOpenBankingBundle, type FeatureToggles } from "@/lib/money-flow/features";
import { EMPTY_LEDGER, type Ledger } from "@/lib/money-flow/ledger";
import {
  FIRST_SYNC_DAYS,
  FiskilAuthError,
  firstSyncFrom,
  listFiskilAccounts,
  listFiskilBalances,
  listFiskilTransactions,
  POLL_INTERVAL_MS,
  type BankingFetchDeps,
} from "./banking";
import { fiskilCredentials, type FiskilCredentials, type FiskilEnv } from "./config";
import {
  type BankConnection,
  type ConnectionStore,
  processConnectionStore,
} from "./connections";
import { type EndUserLinkStore, processEndUserLinkStore } from "./end-users";
import { processLedgerDocumentStore, type LedgerDocumentStore } from "./ledger-store";
import { upsertOpenBankingLedger, type OpenBankingSyncReport } from "@/lib/open-banking/ledger-sync";
import type { TokenCache } from "./token";
import { processWebhookReceiptStore, type FiskilWebhookEvent, type WebhookReceiptStore } from "./webhooks";

export { FIRST_SYNC_DAYS, POLL_INTERVAL_MS };

export type SyncReason = "first_connect" | "webhook" | "poll";

export type SyncDeps = Omit<BankingFetchDeps, "credentials"> & {
  env?: FiskilEnv;
  credentials?: FiskilCredentials | null;
  connections: ConnectionStore;
  endUsers: EndUserLinkStore;
  ledgers: LedgerDocumentStore;
  receipts?: WebhookReceiptStore;
};

export type SyncSuccess = {
  ok: true;
  skipped?: boolean;
  reason: SyncReason;
  connectionId: string;
  firstSync: boolean;
  from?: string;
  to?: string;
  report?: OpenBankingSyncReport;
  reconnect?: boolean;
};

export type SyncFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 502 | 503;
  error: string;
  reconnect?: boolean;
};

export function processSyncDeps(): SyncDeps {
  const credentials = fiskilCredentials();
  return {
    ...(credentials ? { credentials } : {}),
    connections: processConnectionStore(),
    endUsers: processEndUserLinkStore(),
    ledgers: processLedgerDocumentStore(),
    receipts: processWebhookReceiptStore(),
  };
}

export function isDueForPoll(
  connection: BankConnection,
  nowMs: number,
  intervalMs = POLL_INTERVAL_MS,
): boolean {
  if (connection.status !== "active") return false;
  if (connection.syncStoppedReason) return false;
  if (!connection.lastSyncedAt) return true;
  const last = Date.parse(connection.lastSyncedAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= intervalMs;
}

export async function syncOpenBankingConnection(
  input: { connection: BankConnection; reason: SyncReason },
  deps: SyncDeps,
): Promise<SyncSuccess | SyncFailure> {
  const connection = input.connection;
  if (connection.status === "revoked") {
    return { ok: false, status: 409, error: "Bank connection is revoked." };
  }
  if (connection.status === "needs_reconnect" || connection.syncStoppedReason) {
    return {
      ok: true,
      skipped: true,
      reason: input.reason,
      connectionId: connection.id,
      firstSync: !connection.firstSyncCompletedAt,
      reconnect: true,
    };
  }
  if (!connection.consentId && !connection.id) {
    return { ok: false, status: 400, error: "Connection is missing a consent id." };
  }

  const credentials = deps.credentials === undefined ? fiskilCredentials(deps.env) : deps.credentials;
  if (!credentials) return { ok: false, status: 503, error: "Fiskil is not configured on this server." };

  const nowMs = deps.now ? deps.now() : Date.now();
  const firstSync = !connection.firstSyncCompletedAt;
  const to = new Date(nowMs).toISOString();
  const from = firstSync ? firstSyncFrom(nowMs) : connection.lastCursor;

  const banking: BankingFetchDeps = {
    credentials,
    fetchImpl: deps.fetchImpl,
    cache: deps.cache,
    now: deps.now,
    apiBase: deps.apiBase,
  };

  try {
    const accounts = await listFiskilAccounts(connection.endUserId, banking);
    const transactions = await listFiskilTransactions(
      {
        endUserId: connection.endUserId,
        ...(from ? { from } : {}),
        to,
      },
      banking,
    );
    const balances = await listFiskilBalances(connection.endUserId, banking).catch(() => []);

    const ledger = await deps.ledgers.get(connection.userId);
    const { ledger: next, report } = upsertOpenBankingLedger(ledger, {
      consentId: connection.consentId ?? connection.id,
      accounts,
      transactions,
      balances,
      importedAt: to,
      firstSync,
    });
    await deps.ledgers.put(connection.userId, next);

    const updated: BankConnection = {
      ...connection,
      lastSyncedAt: to,
      lastCursor: to,
      ...(firstSync ? { firstSyncCompletedAt: to } : {}),
      syncStoppedReason: undefined,
      status: "active",
    };
    await deps.connections.put(updated);

    return {
      ok: true,
      reason: input.reason,
      connectionId: connection.id,
      firstSync,
      from,
      to,
      report,
    };
  } catch (err) {
    if (err instanceof FiskilAuthError) {
      await stopSync(connection, err.kind, deps.connections);
      return {
        ok: false,
        status: 502,
        error: err.kind === "consent" ? "Bank consent needs reconnect." : "Fiskil token failed. Reconnect the bank.",
        reconnect: true,
      };
    }
    return { ok: false, status: 502, error: "Open Banking sync failed." };
  }
}

export async function scheduleFirstOpenBankingSync(
  connectionId: string,
  deps: SyncDeps = processSyncDeps(),
): Promise<SyncSuccess | SyncFailure | undefined> {
  const connection = await deps.connections.getById(connectionId);
  if (!connection || connection.firstSyncCompletedAt) return undefined;
  try {
    return await syncOpenBankingConnection({ connection, reason: "first_connect" }, deps);
  } catch {
    return undefined;
  }
}

export async function pollDueOpenBankingConnections(
  deps: SyncDeps,
): Promise<Array<SyncSuccess | SyncFailure>> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const due = (await deps.connections.listActive()).filter((row) => isDueForPoll(row, nowMs));
  const results: Array<SyncSuccess | SyncFailure> = [];
  for (const connection of due) {
    results.push(await syncOpenBankingConnection({ connection, reason: "poll" }, deps));
  }
  return results;
}

export async function handleOpenBankingWebhookEvent(
  event: FiskilWebhookEvent,
  deps: SyncDeps,
): Promise<SyncSuccess | SyncFailure | { ok: true; skipped: true }> {
  if (event.event === "consent.revoked" || event.event === "banking.transactions.sync.failed") {
    const connection = await findConnection(event, deps);
    if (connection) await stopSync(connection, "consent", deps.connections);
    return { ok: true, skipped: true };
  }

  const connection = await findConnection(event, deps);
  if (!connection) return { ok: false, status: 404, error: "Unknown bank connection for webhook." };
  const reason: SyncReason = connection.firstSyncCompletedAt ? "webhook" : "first_connect";
  return syncOpenBankingConnection({ connection, reason }, deps);
}

export type ManualSyncInput = {
  userId?: string;
  connectionId?: string;
  featureToggles?: FeatureToggles;
  poll?: boolean;
};

export async function runOpenBankingSyncRequest(
  input: ManualSyncInput,
  deps: SyncDeps,
): Promise<{ ok: true; results: Array<SyncSuccess | SyncFailure> } | SyncFailure> {
  if (input.poll) {
    return { ok: true, results: await pollDueOpenBankingConnections(deps) };
  }
  if (!hasOpenBankingBundle(input.featureToggles)) {
    return { ok: false, status: 403, error: "Open Banking requires the Open Banking Bundle." };
  }
  const connectionId = input.connectionId?.trim();
  const userId = input.userId?.trim();
  if (!connectionId || !userId) {
    return { ok: false, status: 400, error: "userId and connectionId are required." };
  }
  const connection = await deps.connections.getById(connectionId);
  if (!connection || connection.userId !== userId) {
    return { ok: false, status: 404, error: "Unknown bank connection." };
  }
  const result = await syncOpenBankingConnection(
    { connection, reason: connection.firstSyncCompletedAt ? "webhook" : "first_connect" },
    deps,
  );
  return { ok: true, results: [result] };
}

export function emptyUserLedger(): Ledger {
  return EMPTY_LEDGER;
}

async function findConnection(event: FiskilWebhookEvent, deps: SyncDeps): Promise<BankConnection | undefined> {
  if (event.consentId) {
    const byConsent = await deps.connections.getByConsentId(event.consentId);
    if (byConsent) return byConsent;
  }
  if (event.endUserId) {
    const rows = await deps.connections.listByEndUserId(event.endUserId);
    return rows.find((row) => row.status === "active") ?? rows[0];
  }
  return undefined;
}

async function stopSync(
  connection: BankConnection,
  reason: "consent" | "token",
  store: ConnectionStore,
): Promise<void> {
  await store.put({
    ...connection,
    status: "needs_reconnect",
    syncStoppedReason: reason,
  });
}
