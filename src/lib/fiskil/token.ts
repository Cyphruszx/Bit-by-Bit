/**
 * Fiskil app token: client credentials → Bearer, cached server-side.
 *
 * Spec 12.2: POST /v1/token, TTL ~900s, refresh in this process. The secret
 * and the access token stay in this module — never return them to a client
 * handler as a field the browser should see.
 */

import {
  FISKIL_SCOPES,
  FISKIL_TOKEN_REFRESH_SKEW_SECONDS,
  FISKIL_TOKEN_TTL_SECONDS,
  FISKIL_TOKEN_URL,
  type FiskilCredentials,
} from "./config";

export type FiskilAppToken = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAtMs: number;
};

export type TokenCache = {
  read(): FiskilAppToken | undefined;
  write(token: FiskilAppToken): void;
  clear(): void;
};

export function memoryTokenCache(): TokenCache {
  let held: FiskilAppToken | undefined;
  return {
    read: () => held,
    write(token) {
      held = token;
    },
    clear() {
      held = undefined;
    },
  };
}

const processCache = memoryTokenCache();
const inflight = new WeakMap<TokenCache, Promise<FiskilAppToken>>();

export type GetFiskilAppTokenDeps = {
  credentials: FiskilCredentials;
  fetchImpl?: typeof fetch;
  cache?: TokenCache;
  now?: () => number;
  tokenUrl?: string;
  scopes?: readonly string[];
};

export function tokenStillValid(
  token: FiskilAppToken,
  nowMs: number,
  skewSeconds = FISKIL_TOKEN_REFRESH_SKEW_SECONDS,
): boolean {
  return token.expiresAtMs - skewSeconds * 1000 > nowMs;
}

export function processTokenCache(): TokenCache {
  return processCache;
}

export async function getFiskilAppToken(deps: GetFiskilAppTokenDeps): Promise<FiskilAppToken> {
  const cache = deps.cache ?? processCache;
  const now = deps.now ?? Date.now;
  const cached = cache.read();
  if (cached && tokenStillValid(cached, now())) return cached;

  const pending = inflight.get(cache);
  if (pending) return pending;

  const request = fetchFiskilAppToken(deps)
    .then((token) => {
      cache.write(token);
      return token;
    })
    .finally(() => {
      inflight.delete(cache);
    });
  inflight.set(cache, request);
  return request;
}

export function parseTokenResponse(raw: unknown, nowMs: number): FiskilAppToken {
  if (!raw || typeof raw !== "object") throw new Error("Fiskil token response was empty.");
  const body = raw as Record<string, unknown>;
  const accessToken = asNonEmptyString(body.token) ?? asNonEmptyString(body.access_token);
  if (!accessToken) throw new Error("Fiskil token response did not include a token.");
  const expiresIn = asPositiveInt(body.expires_in) ?? FISKIL_TOKEN_TTL_SECONDS;
  return {
    accessToken,
    tokenType: asNonEmptyString(body.token_type) ?? "Bearer",
    expiresIn,
    expiresAtMs: nowMs + expiresIn * 1000,
  };
}

async function fetchFiskilAppToken(deps: GetFiskilAppTokenDeps): Promise<FiskilAppToken> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const scopes = deps.scopes ?? FISKIL_SCOPES;
  const response = await fetchImpl(deps.tokenUrl ?? FISKIL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: deps.credentials.clientId,
      client_secret: deps.credentials.clientSecret,
      grant_type: "client_credentials",
      scope: scopes.join(" "),
    }),
  });

  if (!response.ok) {
    throw new Error(`Fiskil token request failed (${response.status}).`);
  }

  return parseTokenResponse(await readJson(response), now());
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Fiskil token response was not JSON.");
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}
