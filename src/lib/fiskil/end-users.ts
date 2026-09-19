/**
 * Fiskil end user create/link, 1:1 with BitbyBit user_id (Spec 12.2).
 *
 * Look up the stored mapping first. If this person is new to us, ask Fiskil
 * by email and create only when nobody is there. The durable unique on
 * Fiskil's side is email; the durable unique on ours is user_id.
 */

import { hasOpenBankingBundle, parseFeatureToggles, type FeatureToggles } from "@/lib/money-flow/features";
import { FISKIL_API_BASE, fiskilCredentials, type FiskilCredentials, type FiskilEnv } from "./config";
import { getFiskilAppToken, type GetFiskilAppTokenDeps, type TokenCache } from "./token";

export type FiskilEndUserLink = {
  userId: string;
  endUserId: string;
  email: string;
  created: boolean;
};

export type EndUserLinkStore = {
  getByUserId(userId: string): Promise<Omit<FiskilEndUserLink, "created"> | undefined>;
  getByEndUserId(endUserId: string): Promise<Omit<FiskilEndUserLink, "created"> | undefined>;
  put(link: Omit<FiskilEndUserLink, "created">): Promise<void>;
};

export function memoryEndUserLinkStore(): EndUserLinkStore {
  const byUser = new Map<string, Omit<FiskilEndUserLink, "created">>();
  const byEndUser = new Map<string, Omit<FiskilEndUserLink, "created">>();
  return {
    async getByUserId(userId) {
      const held = byUser.get(userId);
      return held ? { ...held } : undefined;
    },
    async getByEndUserId(endUserId) {
      const held = byEndUser.get(endUserId);
      return held ? { ...held } : undefined;
    },
    async put(link) {
      const stored = { userId: link.userId, endUserId: link.endUserId, email: link.email };
      byUser.set(link.userId, stored);
      byEndUser.set(link.endUserId, stored);
    },
  };
}

const processStore = memoryEndUserLinkStore();

export function processEndUserLinkStore(): EndUserLinkStore {
  return processStore;
}

export type EnsureFiskilEndUserInput = {
  userId: string;
  email: string;
  name?: string;
};

export type EnsureFiskilEndUserDeps = {
  credentials: FiskilCredentials;
  store: EndUserLinkStore;
  fetchImpl?: typeof fetch;
  cache?: TokenCache;
  now?: () => number;
  apiBase?: string;
};

export async function ensureFiskilEndUser(
  input: EnsureFiskilEndUserInput,
  deps: EnsureFiskilEndUserDeps,
): Promise<FiskilEndUserLink> {
  const userId = input.userId.trim();
  const email = input.email.trim();
  if (!userId) throw new Error("BitbyBit user_id is required to link a Fiskil end user.");
  if (!email) throw new Error("Email is required to create a Fiskil end user.");

  const existing = await deps.store.getByUserId(userId);
  if (existing) return { ...existing, created: false };

  const token = await appToken(deps);
  const found = await findEndUserIdByEmail(email, token, deps);
  if (found) {
    const link = { userId, endUserId: found, email };
    await deps.store.put(link);
    return { ...link, created: false };
  }

  const created = await createEndUser({ email, name: input.name?.trim() }, token, deps);
  const link = { userId, endUserId: created.endUserId, email };
  await deps.store.put(link);
  return { ...link, created: created.created };
}

export type ProvisionOpenBankingEndUserInput = EnsureFiskilEndUserInput & {
  featureToggles?: FeatureToggles;
};

export type ProvisionOpenBankingEndUserResult =
  | { ok: true; link: FiskilEndUserLink }
  | { ok: false; status: 400 | 403 | 502 | 503; error: string };

export type ProvisionOpenBankingEndUserDeps = Omit<EnsureFiskilEndUserDeps, "credentials"> & {
  env?: FiskilEnv;
  credentials?: FiskilCredentials | null;
};

/**
 * Gate + credentials + create/link. The route handler maps this onto HTTP
 * and must not add the access token or client secret to the body.
 */
export async function provisionOpenBankingEndUser(
  input: ProvisionOpenBankingEndUserInput,
  deps: ProvisionOpenBankingEndUserDeps,
): Promise<ProvisionOpenBankingEndUserResult> {
  const userId = input.userId.trim();
  const email = input.email.trim();
  if (!userId || !email) {
    return { ok: false, status: 400, error: "userId and email are required." };
  }
  if (!hasOpenBankingBundle(input.featureToggles)) {
    return { ok: false, status: 403, error: "Open Banking requires the Open Banking Bundle." };
  }

  const credentials = deps.credentials === undefined ? fiskilCredentials(deps.env) : deps.credentials;
  if (!credentials) {
    return { ok: false, status: 503, error: "Fiskil is not configured on this server." };
  }

  try {
    const link = await ensureFiskilEndUser({ userId, email, name: input.name }, { ...deps, credentials });
    return { ok: true, link };
  } catch {
    return { ok: false, status: 502, error: "Fiskil could not create or link the end user." };
  }
}

export function parseProvisionBody(raw: unknown): ProvisionOpenBankingEndUserInput {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    userId: typeof body.userId === "string" ? body.userId : "",
    email: typeof body.email === "string" ? body.email : "",
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    featureToggles: parseFeatureToggles(body.featureToggles),
  };
}

async function appToken(deps: EnsureFiskilEndUserDeps) {
  const tokenDeps: GetFiskilAppTokenDeps = {
    credentials: deps.credentials,
    fetchImpl: deps.fetchImpl,
    cache: deps.cache,
    now: deps.now,
  };
  return getFiskilAppToken(tokenDeps);
}

async function findEndUserIdByEmail(
  email: string,
  token: { accessToken: string; tokenType: string },
  deps: EnsureFiskilEndUserDeps,
): Promise<string | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(`${deps.apiBase ?? FISKIL_API_BASE}/end-users`);
  url.searchParams.set("email", email);
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: fiskilHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Fiskil end-user lookup failed (${response.status}).`);
  }
  return endUserIdFromList(await readJson(response), email);
}

async function createEndUser(
  body: { email: string; name?: string },
  token: { accessToken: string; tokenType: string },
  deps: EnsureFiskilEndUserDeps,
): Promise<{ endUserId: string; created: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const payload: Record<string, string> = { email: body.email };
  if (body.name) payload.name = body.name;

  const response = await fetchImpl(`${deps.apiBase ?? FISKIL_API_BASE}/end-users`, {
    method: "POST",
    headers: { ...fiskilHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    const endUserId = endUserIdFromCreate(await readJson(response));
    if (!endUserId) throw new Error("Fiskil create end-user response did not include an id.");
    return { endUserId, created: true };
  }

  if (response.status === 400) {
    const existing = await findEndUserIdByEmail(body.email, token, deps);
    if (existing) return { endUserId: existing, created: false };
  }

  throw new Error(`Fiskil create end-user failed (${response.status}).`);
}

export function endUserIdFromCreate(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  return asId(body.end_user_id) ?? asId(body.id);
}

export function endUserIdFromList(raw: unknown, email: string): string | undefined {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { end_users?: unknown }).end_users)
      ? (raw as { end_users: unknown[] }).end_users
      : [];
  const needle = email.trim().toLowerCase();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const rowEmail = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    if (rowEmail && rowEmail !== needle) continue;
    const id = asId(item.id) ?? asId(item.end_user_id);
    if (id) return id;
  }
  return undefined;
}

function fiskilHeaders(token: { accessToken: string; tokenType: string }): HeadersInit {
  return {
    Authorization: `${token.tokenType} ${token.accessToken}`,
    Accept: "application/json",
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Fiskil end-user response was not JSON.");
  }
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
