/**
 * Client-safe Connect bank flow: end-user → auth session → Link → record.
 *
 * This module talks only to our API routes. It must not import @/lib/fiskil
 * or name server secrets — those stay off the client bundle.
 *
 * Requests carry the Supabase access token. The server derives the user from
 * that session, so these calls do not send userId or featureToggles.
 */

import { supabase } from "@/lib/supabase/client";
import { connectionCapMessage, connectionCapReached, MAX_BANK_CONNECTIONS } from "./limits";

export type OpenBankingToggles = { OPEN_BANKING?: boolean };

export type ConnectIdentity = {
  userId: string;
  email: string;
  name?: string;
};

export type ConnectUris = {
  redirectUri: string;
  cancelUri: string;
};

export type StartSessionResult =
  | { ok: true; sessionId: string; connectionCount: number; remaining: number }
  | { ok: false; error: string; code?: string; status?: number; connectionCount?: number };

export type CompleteResult =
  | {
      ok: true;
      id: string;
      connectionCount: number;
      remaining: number;
      ledger?: unknown;
      sync?: { started: boolean; ok?: boolean; error?: string };
    }
  | { ok: false; error: string; code?: string; status?: number; connectionCount?: number };

export type LinkLaunchResult = { consentId?: string };

export type ConnectBankDeps = {
  ensureEndUser: (input: ConnectIdentity & { featureToggles: OpenBankingToggles }) => Promise<StartSessionResult>;
  startSession: (
    input: ConnectIdentity & ConnectUris & { featureToggles: OpenBankingToggles },
  ) => Promise<StartSessionResult>;
  launchLink: (sessionId: string) => Promise<LinkLaunchResult>;
  completeConnection: (
    input: { userId: string; sessionId: string; consentId: string; featureToggles: OpenBankingToggles },
  ) => Promise<CompleteResult>;
};

export function canShowConnectBank(openBankingEnabled: boolean): boolean {
  return openBankingEnabled === true;
}

export function connectBlockedByCap(connectionCount: number): boolean {
  return connectionCapReached(connectionCount);
}

export function connectCapCopy(connectionCount = MAX_BANK_CONNECTIONS): string {
  return connectionCapMessage(connectionCount);
}

export function cancelledLinkMessage(err: unknown): string | undefined {
  const code = errorCode(err);
  if (
    code === "LINK_USER_CANCELLED" ||
    code === "CONSENT_ENDUSER_DENIED" ||
    code === "AUTH_SESSION_CANCELLED"
  ) {
    return "Bank connection was cancelled.";
  }
  return undefined;
}

export function failedLinkMessage(err: unknown): string {
  return cancelledLinkMessage(err) ?? "Could not finish the bank connection.";
}

export type ConnectFlowResult =
  | {
      ok: true;
      id: string;
      connectionCount: number;
      remaining: number;
      ledger?: unknown;
      sync?: { started: boolean; ok?: boolean; error?: string };
    }
  | { ok: false; error: string; code?: string; status?: number; connectionCount?: number; cancelled?: boolean };

export async function runConnectBankFlow(
  input: ConnectIdentity & ConnectUris & { featureToggles: OpenBankingToggles },
  deps: ConnectBankDeps,
): Promise<ConnectFlowResult> {
  if (!canShowConnectBank(input.featureToggles.OPEN_BANKING === true)) {
    return { ok: false, error: "Open Banking requires the Open Banking Bundle." };
  }

  const ensured = await deps.ensureEndUser({
    userId: input.userId,
    email: input.email,
    ...(input.name ? { name: input.name } : {}),
    featureToggles: input.featureToggles,
  });
  if (!ensured.ok) return ensured;

  const started = await deps.startSession(input);
  if (!started.ok) return started;

  try {
    const linked = await deps.launchLink(started.sessionId);
    const consentId = linked.consentId?.trim();
    if (!consentId) return { ok: false, error: "Fiskil Link did not return a consent id." };
    return deps.completeConnection({
      userId: input.userId,
      sessionId: started.sessionId,
      consentId,
      featureToggles: input.featureToggles,
    });
  } catch (err) {
    const cancelled = cancelledLinkMessage(err);
    if (cancelled) return { ok: false, error: cancelled, cancelled: true };
    return { ok: false, error: failedLinkMessage(err), code: errorCode(err) };
  }
}

export async function runReconnectBankFlow(
  input: ConnectIdentity &
    ConnectUris & { featureToggles: OpenBankingToggles; connectionId: string },
  deps: Pick<ConnectBankDeps, "launchLink" | "completeConnection"> & {
    reconnect: (
      input: ConnectIdentity & ConnectUris & { featureToggles: OpenBankingToggles; connectionId: string },
    ) => Promise<StartSessionResult>;
  },
): Promise<ConnectFlowResult> {
  if (!canShowConnectBank(input.featureToggles.OPEN_BANKING === true)) {
    return { ok: false, error: "Open Banking requires the Open Banking Bundle." };
  }
  const started = await deps.reconnect(input);
  if (!started.ok) return started;
  try {
    const linked = await deps.launchLink(started.sessionId);
    const consentId = linked.consentId?.trim();
    if (!consentId) return { ok: false, error: "Fiskil Link did not return a consent id." };
    return deps.completeConnection({
      userId: input.userId,
      sessionId: started.sessionId,
      consentId,
      featureToggles: input.featureToggles,
    });
  } catch (err) {
    const cancelled = cancelledLinkMessage(err);
    if (cancelled) return { ok: false, error: cancelled, cancelled: true };
    return { ok: false, error: failedLinkMessage(err), code: errorCode(err) };
  }
}

export function browserConnectDeps(launchLink: ConnectBankDeps["launchLink"]): ConnectBankDeps {
  return {
    async ensureEndUser(input) {
      return postJson("/api/open-banking/end-user", {
        ...(input.name ? { name: input.name } : {}),
      });
    },
    async startSession(input) {
      return postJson("/api/open-banking/auth-session", {
        ...(input.name ? { name: input.name } : {}),
        redirectUri: input.redirectUri,
        cancelUri: input.cancelUri,
      });
    },
    launchLink,
    async completeConnection(input) {
      return postJson("/api/open-banking/connections", {
        action: "complete",
        sessionId: input.sessionId,
        consentId: input.consentId,
      });
    },
  };
}

export async function fetchOpenBankingConnections(): Promise<{
  connections: { id: string; status: string; createdAt: string }[];
  connectionCount: number;
  remaining: number;
  max: number;
}> {
  const response = await fetch("/api/open-banking/connections", { headers: await sessionHeaders() });
  const body = (await readBody(response)) as {
    connections?: { id: string; status: string; createdAt: string }[];
    connectionCount?: number;
    remaining?: number;
    max?: number;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Could not load bank connections.");
  }
  return {
    connections: body.connections ?? [],
    connectionCount: body.connectionCount ?? 0,
    remaining: body.remaining ?? MAX_BANK_CONNECTIONS,
    max: body.max ?? MAX_BANK_CONNECTIONS,
  };
}

export async function revokeOpenBankingConnection(input: {
  connectionId: string;
}): Promise<CompleteResult> {
  return postJson("/api/open-banking/connections", {
    action: "revoke",
    connectionId: input.connectionId,
  });
}

export async function requestOpenBankingSync(input: {
  connectionId: string;
}): Promise<CompleteResult> {
  return postJson("/api/open-banking/sync", {
    connectionId: input.connectionId,
  });
}

/**
 * Account-delete / leave-product hook. Sign-out does not call this.
 * Last bank disconnect also deletes the Fiskil end user from the revoke path.
 */
export async function leaveOpenBankingProduct(): Promise<
  { ok: true; deleted: boolean; skipped?: boolean } | { ok: false; error: string; status?: number }
> {
  const response = await fetch("/api/open-banking/end-user", {
    method: "DELETE",
    headers: await sessionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  const body = (await readBody(response)) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Could not delete the Open Banking end user.",
      status: response.status,
    };
  }
  return {
    ok: true,
    deleted: body.deleted === true,
    ...(body.skipped === true ? { skipped: true } : {}),
  };
}

export async function reconnectOpenBankingSession(input: ConnectIdentity &
  ConnectUris & { featureToggles: OpenBankingToggles; connectionId: string }): Promise<StartSessionResult> {
  return postJson("/api/open-banking/connections", {
    action: "reconnect",
    ...(input.name ? { name: input.name } : {}),
    redirectUri: input.redirectUri,
    cancelUri: input.cancelUri,
    connectionId: input.connectionId,
  });
}

async function sessionHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const client = supabase();
  if (!client) return headers;
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    return headers;
  }
  return headers;
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      sessionId: string;
      id: string;
      connectionCount: number;
      remaining: number;
      ledger?: unknown;
      sync?: { started: boolean; ok?: boolean; error?: string };
    }
  | { ok: false; error: string; code?: string; status?: number; connectionCount?: number }
> {
  const response = await fetch(url, {
    method: "POST",
    headers: await sessionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const body = (await readBody(response)) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Open Banking request failed.",
      code: typeof body.code === "string" ? body.code : undefined,
      status: response.status,
      connectionCount: typeof body.connectionCount === "number" ? body.connectionCount : undefined,
    };
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const id =
    typeof body.id === "string"
      ? body.id
      : body.connection && typeof body.connection === "object" && typeof (body.connection as { id?: unknown }).id === "string"
        ? (body.connection as { id: string }).id
        : sessionId;
  const sync =
    body.sync && typeof body.sync === "object"
      ? (body.sync as { started?: unknown; ok?: unknown; error?: unknown })
      : undefined;
  return {
    ok: true,
    sessionId,
    id,
    connectionCount: typeof body.connectionCount === "number" ? body.connectionCount : 0,
    remaining: typeof body.remaining === "number" ? body.remaining : 0,
    ...(body.ledger !== undefined ? { ledger: body.ledger } : {}),
    ...(sync
      ? {
          sync: {
            started: sync.started === true,
            ...(typeof sync.ok === "boolean" ? { ok: sync.ok } : {}),
            ...(typeof sync.error === "string" ? { error: sync.error } : {}),
          },
        }
      : {}),
  };
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}

export { MAX_BANK_CONNECTIONS };
