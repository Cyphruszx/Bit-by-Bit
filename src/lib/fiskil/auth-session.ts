/**
 * Fiskil auth session create (Spec 12 Slice 2 / §§12.2–12.3 connect start).
 *
 * POST /v1/auth/session with the app Bearer token. Session ids are stored
 * server-side; the browser only ever gets session_id to launch Link.
 */

import { FISKIL_API_BASE, type FiskilCredentials } from "./config";
import { getFiskilAppToken, type GetFiskilAppTokenDeps, type TokenCache } from "./token";

export const FISKIL_AUTH_SESSION_URL = `${FISKIL_API_BASE}/auth/session`;

export type FiskilAuthSession = {
  sessionId: string;
  fiskilId?: string;
  authUrl?: string;
  expiresAt?: number;
};

export type CreateFiskilAuthSessionInput = {
  endUserId: string;
  redirectUri: string;
  cancelUri: string;
};

export type CreateFiskilAuthSessionDeps = {
  credentials: FiskilCredentials;
  fetchImpl?: typeof fetch;
  cache?: TokenCache;
  now?: () => number;
  apiBase?: string;
};

export async function createFiskilAuthSession(
  input: CreateFiskilAuthSessionInput,
  deps: CreateFiskilAuthSessionDeps,
): Promise<FiskilAuthSession> {
  const endUserId = input.endUserId.trim();
  const redirectUri = input.redirectUri.trim();
  const cancelUri = input.cancelUri.trim();
  if (!endUserId) throw new Error("end_user_id is required to create a Fiskil auth session.");
  if (!redirectUri) throw new Error("redirect_uri is required to create a Fiskil auth session.");
  if (!cancelUri) throw new Error("cancel_uri is required to create a Fiskil auth session.");

  const token = await appToken(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = `${deps.apiBase ?? FISKIL_API_BASE}/auth/session`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `${token.tokenType} ${token.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      end_user_id: endUserId,
      redirect_uri: redirectUri,
      cancel_uri: cancelUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Fiskil auth session create failed (${response.status}).`);
  }

  return parseAuthSessionResponse(await readJson(response));
}

export function parseAuthSessionResponse(raw: unknown): FiskilAuthSession {
  if (!raw || typeof raw !== "object") throw new Error("Fiskil auth session response was empty.");
  const body = raw as Record<string, unknown>;
  const sessionId = asNonEmpty(body.session_id);
  if (!sessionId) throw new Error("Fiskil auth session response did not include session_id.");
  const session: FiskilAuthSession = { sessionId };
  const fiskilId = asNonEmpty(body.id);
  if (fiskilId) session.fiskilId = fiskilId;
  const authUrl = asNonEmpty(body.auth_url);
  if (authUrl) session.authUrl = authUrl;
  const expiresAt = asUnixSeconds(body.expires_at);
  if (expiresAt !== undefined) session.expiresAt = expiresAt;
  return session;
}

async function appToken(deps: CreateFiskilAuthSessionDeps) {
  const tokenDeps: GetFiskilAppTokenDeps = {
    credentials: deps.credentials,
    fetchImpl: deps.fetchImpl,
    cache: deps.cache,
    now: deps.now,
  };
  return getFiskilAppToken(tokenDeps);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Fiskil auth session response was not JSON.");
  }
}

function asNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asUnixSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}
