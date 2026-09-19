/**
 * Bank-link connections and auth-session records (Spec 12 Slice 2).
 *
 * Session ids stay on the server. The 5-connection cap is enforced before
 * Fiskil mints a new session. Reconnect / revoke are stubs: they update our
 * store and can mint a new session, but they do not call Fiskil revoke yet.
 */

import {
  CONNECTION_CAP_CODE,
  connectionCapMessage,
  connectionCapReached,
  MAX_BANK_CONNECTIONS,
  remainingConnections,
} from "@/lib/open-banking/limits";
import { hasOpenBankingBundle, parseFeatureToggles, type FeatureToggles } from "@/lib/money-flow/features";
import { createFiskilAuthSession, type FiskilAuthSession } from "./auth-session";
import { fiskilCredentials, type FiskilCredentials, type FiskilEnv } from "./config";
import { ensureFiskilEndUser, type EndUserLinkStore } from "./end-users";
import type { TokenCache } from "./token";

export type BankConnectionStatus = "active" | "revoked" | "needs_reconnect";

export type BankConnection = {
  id: string;
  userId: string;
  endUserId: string;
  sessionId: string;
  consentId?: string;
  status: BankConnectionStatus;
  createdAt: string;
  revokedAt?: string;
  /** RFC3339 of the last successful accounts/transactions upsert. */
  lastSyncedAt?: string;
  /** Incremental `from` watermark. First connect uses 90 days instead. */
  lastCursor?: string;
  firstSyncCompletedAt?: string;
  /** Set when consent/token fail stops sync. Existing CLEARED rows stay. */
  syncStoppedReason?: "consent" | "token";
};

export type StoredAuthSession = {
  sessionId: string;
  userId: string;
  endUserId: string;
  redirectUri: string;
  cancelUri: string;
  createdAt: string;
  expiresAt?: number;
  fiskilId?: string;
  authUrl?: string;
  connectionId?: string;
};

export type ConnectionStore = {
  listByUserId(userId: string): Promise<BankConnection[]>;
  listActive(): Promise<BankConnection[]>;
  getById(id: string): Promise<BankConnection | undefined>;
  getByConsentId(consentId: string): Promise<BankConnection | undefined>;
  listByEndUserId(endUserId: string): Promise<BankConnection[]>;
  put(connection: BankConnection): Promise<void>;
};

export type AuthSessionStore = {
  getBySessionId(sessionId: string): Promise<StoredAuthSession | undefined>;
  put(session: StoredAuthSession): Promise<void>;
};

export function memoryConnectionStore(): ConnectionStore {
  const byId = new Map<string, BankConnection>();
  return {
    async listByUserId(userId) {
      return [...byId.values()].filter((row) => row.userId === userId).map((row) => ({ ...row }));
    },
    async listActive() {
      return [...byId.values()].filter((row) => row.status === "active").map((row) => ({ ...row }));
    },
    async getById(id) {
      const held = byId.get(id);
      return held ? { ...held } : undefined;
    },
    async getByConsentId(consentId) {
      const needle = consentId.trim();
      const held = [...byId.values()].find((row) => row.consentId === needle || row.id === needle);
      return held ? { ...held } : undefined;
    },
    async listByEndUserId(endUserId) {
      return [...byId.values()].filter((row) => row.endUserId === endUserId).map((row) => ({ ...row }));
    },
    async put(connection) {
      byId.set(connection.id, { ...connection });
    },
  };
}

export function memoryAuthSessionStore(): AuthSessionStore {
  const byId = new Map<string, StoredAuthSession>();
  return {
    async getBySessionId(sessionId) {
      const held = byId.get(sessionId);
      return held ? { ...held } : undefined;
    },
    async put(session) {
      byId.set(session.sessionId, { ...session });
    },
  };
}

const processConnections = memoryConnectionStore();
const processSessions = memoryAuthSessionStore();

export function processConnectionStore(): ConnectionStore {
  return processConnections;
}

export function processAuthSessionStore(): AuthSessionStore {
  return processSessions;
}

export function activeConnectionCount(connections: readonly BankConnection[]): number {
  return connections.filter((row) => row.status === "active").length;
}

export type PublicBankConnection = {
  id: string;
  status: BankConnectionStatus;
  createdAt: string;
};

export function toPublicConnection(connection: BankConnection): PublicBankConnection {
  return { id: connection.id, status: connection.status, createdAt: connection.createdAt };
}

export type ConnectFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 502 | 503;
  error: string;
  code?: typeof CONNECTION_CAP_CODE;
  connectionCount?: number;
  remaining?: number;
};

export type StartLinkSessionSuccess = {
  ok: true;
  sessionId: string;
  connectionCount: number;
  remaining: number;
};

export type StartLinkSessionInput = {
  userId: string;
  email: string;
  name?: string;
  featureToggles?: FeatureToggles;
  redirectUri: string;
  cancelUri: string;
};

export type ConnectDeps = {
  env?: FiskilEnv;
  credentials?: FiskilCredentials | null;
  endUsers: EndUserLinkStore;
  connections: ConnectionStore;
  sessions: AuthSessionStore;
  fetchImpl?: typeof fetch;
  cache?: TokenCache;
  now?: () => number;
  apiBase?: string;
};

export async function startOpenBankingLinkSession(
  input: StartLinkSessionInput,
  deps: ConnectDeps,
): Promise<StartLinkSessionSuccess | ConnectFailure> {
  const prepared = await prepareConnect(input, deps);
  if (!prepared.ok) return prepared;

  const { credentials, userId, email, redirectUri, cancelUri, connections, now } = prepared;
  const count = activeConnectionCount(connections);
  if (connectionCapReached(count)) {
    return capFailure(count);
  }

  try {
    const link = await ensureFiskilEndUser(
      { userId, email, name: input.name },
      {
        credentials,
        store: deps.endUsers,
        fetchImpl: deps.fetchImpl,
        cache: deps.cache,
        now: deps.now,
        apiBase: deps.apiBase,
      },
    );
    const created = await createFiskilAuthSession(
      { endUserId: link.endUserId, redirectUri, cancelUri },
      {
        credentials,
        fetchImpl: deps.fetchImpl,
        cache: deps.cache,
        now: deps.now,
        apiBase: deps.apiBase,
      },
    );
    await storeSession(deps.sessions, created, {
      userId,
      endUserId: link.endUserId,
      redirectUri,
      cancelUri,
      now,
    });
    return {
      ok: true,
      sessionId: created.sessionId,
      connectionCount: count,
      remaining: remainingConnections(count),
    };
  } catch {
    return { ok: false, status: 502, error: "Fiskil could not start the bank connection." };
  }
}

export type CompleteConnectionInput = {
  userId: string;
  sessionId: string;
  consentId: string;
  featureToggles?: FeatureToggles;
};

export type CompleteConnectionSuccess = {
  ok: true;
  connection: PublicBankConnection;
  connectionCount: number;
  remaining: number;
};

export async function completeOpenBankingConnection(
  input: CompleteConnectionInput,
  deps: ConnectDeps,
): Promise<CompleteConnectionSuccess | ConnectFailure> {
  const userId = input.userId.trim();
  const sessionId = input.sessionId.trim();
  const consentId = input.consentId.trim();
  if (!userId || !sessionId || !consentId) {
    return { ok: false, status: 400, error: "userId, sessionId, and consentId are required." };
  }
  if (!hasOpenBankingBundle(input.featureToggles)) {
    return { ok: false, status: 403, error: "Open Banking requires the Open Banking Bundle." };
  }

  const session = await deps.sessions.getBySessionId(sessionId);
  if (!session || session.userId !== userId) {
    return { ok: false, status: 404, error: "Unknown Open Banking session." };
  }

  const existing = await deps.connections.listByUserId(userId);
  const already = existing.find(
    (row) => row.consentId === consentId || row.id === consentId || row.sessionId === sessionId,
  );
  if (already) {
    const next: BankConnection = {
      ...already,
      sessionId,
      consentId,
      status: "active",
      revokedAt: undefined,
    };
    await deps.connections.put(next);
    const count = activeConnectionCount(await deps.connections.listByUserId(userId));
    return {
      ok: true,
      connection: toPublicConnection(next),
      connectionCount: count,
      remaining: remainingConnections(count),
    };
  }

  const count = activeConnectionCount(existing);
  if (connectionCapReached(count)) {
    return capFailure(count);
  }

  const now = isoNow(deps.now);
  const connection: BankConnection = {
    id: consentId,
    userId,
    endUserId: session.endUserId,
    sessionId,
    consentId,
    status: "active",
    createdAt: now,
  };
  await deps.connections.put(connection);
  const nextCount = count + 1;
  return {
    ok: true,
    connection: toPublicConnection(connection),
    connectionCount: nextCount,
    remaining: remainingConnections(nextCount),
  };
}

export type ListConnectionsInput = {
  userId: string;
};

export type ListConnectionsSuccess = {
  ok: true;
  connections: PublicBankConnection[];
  connectionCount: number;
  remaining: number;
  max: typeof MAX_BANK_CONNECTIONS;
};

export async function listOpenBankingConnections(
  input: ListConnectionsInput,
  deps: Pick<ConnectDeps, "connections">,
): Promise<ListConnectionsSuccess | ConnectFailure> {
  const userId = input.userId.trim();
  if (!userId) return { ok: false, status: 400, error: "userId is required." };
  const rows = await deps.connections.listByUserId(userId);
  const count = activeConnectionCount(rows);
  return {
    ok: true,
    connections: rows.map(toPublicConnection),
    connectionCount: count,
    remaining: remainingConnections(count),
    max: MAX_BANK_CONNECTIONS,
  };
}

export type RevokeConnectionInput = {
  userId: string;
  connectionId: string;
  featureToggles?: FeatureToggles;
};

export async function revokeOpenBankingConnection(
  input: RevokeConnectionInput,
  deps: ConnectDeps,
): Promise<CompleteConnectionSuccess | ConnectFailure> {
  const gated = requireBundle(input.featureToggles);
  if (gated) return gated;
  const found = await ownedConnection(input.userId, input.connectionId, deps.connections);
  if (!found.ok) return found;

  const now = isoNow(deps.now);
  const next: BankConnection = { ...found.connection, status: "revoked", revokedAt: now };
  await deps.connections.put(next);
  const count = activeConnectionCount(await deps.connections.listByUserId(found.connection.userId));
  return {
    ok: true,
    connection: toPublicConnection(next),
    connectionCount: count,
    remaining: remainingConnections(count),
  };
}

export type ReconnectConnectionInput = StartLinkSessionInput & {
  connectionId: string;
};

export async function reconnectOpenBankingConnection(
  input: ReconnectConnectionInput,
  deps: ConnectDeps,
): Promise<StartLinkSessionSuccess | ConnectFailure> {
  const prepared = await prepareConnect(input, deps);
  if (!prepared.ok) return prepared;

  const found = await ownedConnection(prepared.userId, input.connectionId, deps.connections);
  if (!found.ok) return found;

  try {
    const created = await createFiskilAuthSession(
      {
        endUserId: found.connection.endUserId,
        redirectUri: prepared.redirectUri,
        cancelUri: prepared.cancelUri,
      },
      {
        credentials: prepared.credentials,
        fetchImpl: deps.fetchImpl,
        cache: deps.cache,
        now: deps.now,
        apiBase: deps.apiBase,
      },
    );
    await storeSession(deps.sessions, created, {
      userId: prepared.userId,
      endUserId: found.connection.endUserId,
      redirectUri: prepared.redirectUri,
      cancelUri: prepared.cancelUri,
      now: prepared.now,
      connectionId: found.connection.id,
    });
    const next: BankConnection = { ...found.connection, status: "needs_reconnect", sessionId: created.sessionId };
    await deps.connections.put(next);
    const count = activeConnectionCount(await deps.connections.listByUserId(prepared.userId));
    return {
      ok: true,
      sessionId: created.sessionId,
      connectionCount: count,
      remaining: remainingConnections(count),
    };
  } catch {
    return { ok: false, status: 502, error: "Fiskil could not restart the bank connection." };
  }
}

export function parseStartSessionBody(raw: unknown): StartLinkSessionInput {
  const body = asRecord(raw);
  return {
    userId: asString(body.userId),
    email: asString(body.email),
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    featureToggles: parseFeatureToggles(body.featureToggles),
    redirectUri: asString(body.redirectUri),
    cancelUri: asString(body.cancelUri),
  };
}

export function parseCompleteBody(raw: unknown): CompleteConnectionInput {
  const body = asRecord(raw);
  return {
    userId: asString(body.userId),
    sessionId: asString(body.sessionId),
    consentId: asString(body.consentId),
    featureToggles: parseFeatureToggles(body.featureToggles),
  };
}

export function parseRevokeBody(raw: unknown): RevokeConnectionInput {
  const body = asRecord(raw);
  return {
    userId: asString(body.userId),
    connectionId: asString(body.connectionId),
    featureToggles: parseFeatureToggles(body.featureToggles),
  };
}

export function parseReconnectBody(raw: unknown): ReconnectConnectionInput {
  const body = asRecord(raw);
  return {
    ...parseStartSessionBody(body),
    connectionId: asString(body.connectionId),
  };
}

export function parseListQuery(url: URL): ListConnectionsInput {
  return { userId: url.searchParams.get("userId") ?? "" };
}

export function publicStartSession(result: StartLinkSessionSuccess): Record<string, unknown> {
  return {
    sessionId: result.sessionId,
    connectionCount: result.connectionCount,
    remaining: result.remaining,
  };
}

export function publicConnectFailure(result: ConnectFailure): Record<string, unknown> {
  return {
    error: result.error,
    ...(result.code ? { code: result.code } : {}),
    ...(result.connectionCount !== undefined ? { connectionCount: result.connectionCount } : {}),
    ...(result.remaining !== undefined ? { remaining: result.remaining } : {}),
  };
}

type PreparedConnect = {
  ok: true;
  credentials: FiskilCredentials;
  userId: string;
  email: string;
  redirectUri: string;
  cancelUri: string;
  connections: BankConnection[];
  now: string;
};

async function prepareConnect(
  input: StartLinkSessionInput,
  deps: ConnectDeps,
): Promise<PreparedConnect | ConnectFailure> {
  const userId = input.userId.trim();
  const email = input.email.trim();
  const redirectUri = asHttpUrl(input.redirectUri);
  const cancelUri = asHttpUrl(input.cancelUri);
  if (!userId || !email) {
    return { ok: false, status: 400, error: "userId and email are required." };
  }
  if (!redirectUri || !cancelUri) {
    return { ok: false, status: 400, error: "redirectUri and cancelUri must be http(s) URLs." };
  }
  if (!hasOpenBankingBundle(input.featureToggles)) {
    return { ok: false, status: 403, error: "Open Banking requires the Open Banking Bundle." };
  }
  const credentials = deps.credentials === undefined ? fiskilCredentials(deps.env) : deps.credentials;
  if (!credentials) {
    return { ok: false, status: 503, error: "Fiskil is not configured on this server." };
  }
  const connections = await deps.connections.listByUserId(userId);
  return {
    ok: true,
    credentials,
    userId,
    email,
    redirectUri,
    cancelUri,
    connections,
    now: isoNow(deps.now),
  };
}

function capFailure(count: number): ConnectFailure {
  return {
    ok: false,
    status: 409,
    error: connectionCapMessage(count),
    code: CONNECTION_CAP_CODE,
    connectionCount: count,
    remaining: 0,
  };
}

function requireBundle(featureToggles?: FeatureToggles): ConnectFailure | undefined {
  if (!hasOpenBankingBundle(featureToggles)) {
    return { ok: false, status: 403, error: "Open Banking requires the Open Banking Bundle." };
  }
  return undefined;
}

async function ownedConnection(
  userIdRaw: string,
  connectionIdRaw: string,
  store: ConnectionStore,
): Promise<{ ok: true; connection: BankConnection } | ConnectFailure> {
  const userId = userIdRaw.trim();
  const connectionId = connectionIdRaw.trim();
  if (!userId || !connectionId) {
    return { ok: false, status: 400, error: "userId and connectionId are required." };
  }
  const connection = await store.getById(connectionId);
  if (!connection || connection.userId !== userId) {
    return { ok: false, status: 404, error: "Unknown bank connection." };
  }
  return { ok: true, connection };
}

async function storeSession(
  store: AuthSessionStore,
  created: FiskilAuthSession,
  meta: {
    userId: string;
    endUserId: string;
    redirectUri: string;
    cancelUri: string;
    now: string;
    connectionId?: string;
  },
): Promise<void> {
  const stored: StoredAuthSession = {
    sessionId: created.sessionId,
    userId: meta.userId,
    endUserId: meta.endUserId,
    redirectUri: meta.redirectUri,
    cancelUri: meta.cancelUri,
    createdAt: meta.now,
    ...(created.expiresAt !== undefined ? { expiresAt: created.expiresAt } : {}),
    ...(created.fiskilId ? { fiskilId: created.fiskilId } : {}),
    ...(created.authUrl ? { authUrl: created.authUrl } : {}),
    ...(meta.connectionId ? { connectionId: meta.connectionId } : {}),
  };
  await store.put(stored);
}

function isoNow(now?: () => number): string {
  return new Date(now ? now() : Date.now()).toISOString();
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

export { CONNECTION_CAP_CODE, MAX_BANK_CONNECTIONS };
