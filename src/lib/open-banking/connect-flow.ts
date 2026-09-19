/**
 * Client-safe Connect bank flow: end-user → auth session → Link → record.
 *
 * This module talks only to our API routes. It must not import @/lib/fiskil
 * or name server secrets — those stay off the client bundle.
 */

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
  | { ok: true; id: string; connectionCount: number; remaining: number }
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
  | { ok: true; id: string; connectionCount: number; remaining: number }
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
        userId: input.userId,
        email: input.email,
        ...(input.name ? { name: input.name } : {}),
        featureToggles: input.featureToggles,
      });
    },
    async startSession(input) {
      return postJson("/api/open-banking/auth-session", {
        userId: input.userId,
        email: input.email,
        ...(input.name ? { name: input.name } : {}),
        featureToggles: input.featureToggles,
        redirectUri: input.redirectUri,
        cancelUri: input.cancelUri,
      });
    },
    launchLink,
    async completeConnection(input) {
      return postJson("/api/open-banking/connections", {
        action: "complete",
        userId: input.userId,
        sessionId: input.sessionId,
        consentId: input.consentId,
        featureToggles: input.featureToggles,
      });
    },
  };
}

export async function fetchOpenBankingConnections(userId: string): Promise<{
  connections: { id: string; status: string; createdAt: string }[];
  connectionCount: number;
  remaining: number;
  max: number;
}> {
  const response = await fetch(`/api/open-banking/connections?userId=${encodeURIComponent(userId)}`);
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
  userId: string;
  connectionId: string;
  featureToggles: OpenBankingToggles;
}): Promise<CompleteResult> {
  return postJson("/api/open-banking/connections", {
    action: "revoke",
    userId: input.userId,
    connectionId: input.connectionId,
    featureToggles: input.featureToggles,
  });
}

export async function reconnectOpenBankingSession(input: ConnectIdentity &
  ConnectUris & { featureToggles: OpenBankingToggles; connectionId: string }): Promise<StartSessionResult> {
  return postJson("/api/open-banking/connections", {
    action: "reconnect",
    userId: input.userId,
    email: input.email,
    ...(input.name ? { name: input.name } : {}),
    featureToggles: input.featureToggles,
    redirectUri: input.redirectUri,
    cancelUri: input.cancelUri,
    connectionId: input.connectionId,
  });
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
): Promise<
  | { ok: true; sessionId: string; id: string; connectionCount: number; remaining: number }
  | { ok: false; error: string; code?: string; status?: number; connectionCount?: number }
> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return {
    ok: true,
    sessionId,
    id,
    connectionCount: typeof body.connectionCount === "number" ? body.connectionCount : 0,
    remaining: typeof body.remaining === "number" ? body.remaining : 0,
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
