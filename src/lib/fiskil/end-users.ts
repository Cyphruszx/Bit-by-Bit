/**
 * Fiskil end user create/link, 1:1 with BitbyBit user_id (Spec 12.2).
 *
 * Look up the stored mapping first. If this person is new to us, ask Fiskil
 * by email and create only when nobody is there. The durable unique on
 * Fiskil's side is email; the durable unique on ours is user_id.
 *
 * Live GET /end-users?email= returns 400 { name: "end_user_not_found" } when
 * nobody is there — that is "no match", not a hard failure. Auth and 5xx
 * still fail the lookup.
 *
 * Leave-product: DELETE /end-users/{id} on account-delete or last bank
 * disconnect. Sign-out does not delete the Fiskil end user.
 */

import { hasOpenBankingBundle, parseFeatureToggles, type FeatureToggles } from "@/lib/money-flow/features";
import type { BankConnection, ConnectionStore } from "./connections";
import { FISKIL_API_BASE, fiskilCredentials, type FiskilCredentials, type FiskilEnv } from "./config";
import { errorIdOf, fiskilErrorFromResponse, withFiskilRetry } from "./errors";
import { logFiskilSupport } from "./log";
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
  deleteByUserId(userId: string): Promise<void>;
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
    async deleteByUserId(userId) {
      const held = byUser.get(userId);
      if (!held) return;
      byUser.delete(userId);
      byEndUser.delete(held.endUserId);
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
  sleep?: (ms: number) => Promise<void>;
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
    logFiskilSupport("open_banking.end_user.provisioned", { end_user_id: link.endUserId }, {
      action: link.created ? "created" : "linked",
    });
    return { ok: true, link };
  } catch (err) {
    logFiskilSupport("open_banking.end_user.provision_failed", { error_id: errorIdOf(err) }, { status: 502 });
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

export function parseLeaveBody(raw: unknown): { userId: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { userId: typeof body.userId === "string" ? body.userId : "" };
}

export type LeaveOpenBankingReason = "account_delete" | "last_bank_disconnect";

export type LeaveOpenBankingDeps = Omit<EnsureFiskilEndUserDeps, "credentials" | "store"> & {
  env?: FiskilEnv;
  credentials?: FiskilCredentials | null;
  endUsers: EndUserLinkStore;
  connections?: ConnectionStore;
};

export type LeaveOpenBankingSuccess = {
  ok: true;
  deleted: boolean;
  skipped?: boolean;
  alreadyGone?: boolean;
  endUserId?: string;
};

export type LeaveOpenBankingFailure = {
  ok: false;
  status: 400 | 502 | 503;
  error: string;
  errorId?: string;
  endUserId?: string;
};

/**
 * Delete the linked Fiskil end user when the BitbyBit person leaves the product.
 *
 * Triggers: DELETE /api/open-banking/end-user (account-delete hook) and last
 * bank disconnect. Sign-out is not leave-product and does not call this.
 */
export async function leaveOpenBankingProduct(
  input: { userId: string; reason: LeaveOpenBankingReason },
  deps: LeaveOpenBankingDeps,
): Promise<LeaveOpenBankingSuccess | LeaveOpenBankingFailure> {
  const userId = input.userId.trim();
  if (!userId) return { ok: false, status: 400, error: "userId is required." };

  const link = await deps.endUsers.getByUserId(userId);
  if (!link) {
    logFiskilSupport("open_banking.end_user.leave_skipped", {}, { action: input.reason });
    return { ok: true, deleted: false, skipped: true };
  }

  if (input.reason === "account_delete" && deps.connections) {
    await revokeRemainingConnections(userId, deps.connections, deps.now);
  }

  const credentials = deps.credentials === undefined ? fiskilCredentials(deps.env) : deps.credentials;
  if (!credentials) {
    logFiskilSupport("open_banking.end_user.leave_failed", { end_user_id: link.endUserId }, {
      status: 503,
      action: input.reason,
    });
    return { ok: false, status: 503, error: "Fiskil is not configured on this server.", endUserId: link.endUserId };
  }

  try {
    const deleted = await deleteFiskilEndUser(link.endUserId, { ...deps, credentials, store: deps.endUsers });
    await deps.endUsers.deleteByUserId(userId);
    logFiskilSupport("open_banking.end_user.deleted", { end_user_id: link.endUserId }, { action: input.reason });
    return {
      ok: true,
      deleted: true,
      endUserId: link.endUserId,
      ...(deleted.alreadyGone ? { alreadyGone: true } : {}),
    };
  } catch (err) {
    const errorId = errorIdOf(err);
    logFiskilSupport("open_banking.end_user.delete_failed", { end_user_id: link.endUserId, error_id: errorId }, {
      status: 502,
      action: input.reason,
    });
    return {
      ok: false,
      status: 502,
      error: "Fiskil could not delete the end user.",
      endUserId: link.endUserId,
      ...(errorId ? { errorId } : {}),
    };
  }
}

export async function deleteFiskilEndUser(
  endUserId: string,
  deps: EnsureFiskilEndUserDeps,
): Promise<{ alreadyGone: boolean }> {
  const id = endUserId.trim();
  if (!id) throw new Error("end_user_id is required to delete a Fiskil end user.");

  const token = await appToken(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  return withFiskilRetry(async () => {
    const response = await fetchImpl(`${deps.apiBase ?? FISKIL_API_BASE}/end-users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: fiskilHeaders(token),
    });
    if (response.status === 204 || response.ok) return { alreadyGone: false };
    const raw = await peekJson(response);
    if (isFiskilEndUserNotFound(response.status, raw)) return { alreadyGone: true };
    throw fiskilErrorFromResponse(response.status, raw, "Fiskil end-user delete");
  }, { sleep: deps.sleep });
}

export function hasLiveBankConnection(connections: readonly BankConnection[]): boolean {
  return connections.some((row) => row.status === "active" || row.status === "needs_reconnect");
}

async function revokeRemainingConnections(
  userId: string,
  store: ConnectionStore,
  now?: () => number,
): Promise<void> {
  const at = new Date(now ? now() : Date.now()).toISOString();
  const rows = await store.listByUserId(userId);
  for (const row of rows) {
    if (row.status === "revoked") continue;
    await store.put({ ...row, status: "revoked", revokedAt: at, syncStoppedReason: undefined });
  }
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
  return listEndUsersForEmail(email, token, deps, { filterByEmail: true });
}

async function listEndUsersForEmail(
  email: string,
  token: { accessToken: string; tokenType: string },
  deps: EnsureFiskilEndUserDeps,
  options: { filterByEmail: boolean },
): Promise<string | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(`${deps.apiBase ?? FISKIL_API_BASE}/end-users`);
  if (options.filterByEmail) url.searchParams.set("email", email);
  return withFiskilRetry(async () => {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: fiskilHeaders(token),
    });
    if (response.ok) {
      return endUserIdFromList(await readJson(response), email);
    }
    const raw = await peekJson(response);
    if (isFiskilEndUserNotFound(response.status, raw)) return undefined;
    throw fiskilErrorFromResponse(response.status, raw, "Fiskil end-user lookup");
  }, { sleep: deps.sleep });
}

async function createEndUser(
  body: { email: string; name?: string },
  token: { accessToken: string; tokenType: string },
  deps: EnsureFiskilEndUserDeps,
): Promise<{ endUserId: string; created: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const payload: Record<string, string> = { email: body.email };
  if (body.name) payload.name = body.name;

  return withFiskilRetry(async () => {
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

    const raw = await peekJson(response);
    const fromBody = endUserIdFromCreateError(raw);
    if (fromBody) return { endUserId: fromBody, created: false };

    if (response.status === 400) {
      const existing = await findEndUserIdByEmail(body.email, token, deps);
      if (existing) return { endUserId: existing, created: false };

      if (isFiskilEndUserAlreadyExists(raw)) {
        const listed = await listEndUsersForEmail(body.email, token, deps, { filterByEmail: false });
        if (listed) return { endUserId: listed, created: false };
      }
    }

    throw fiskilErrorFromResponse(response.status, raw, "Fiskil create end-user");
  }, { sleep: deps.sleep });
}

export function endUserIdFromCreate(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;
  return asId(body.end_user_id) ?? asId(body.id);
}

/** Error bodies use `id` for the occurrence, not the end user. */
export function endUserIdFromCreateError(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return asId((raw as Record<string, unknown>).end_user_id);
}

export function isFiskilEndUserNotFound(status: number, raw: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const name = fiskilErrorName(raw);
  if (name.includes("not_found")) return true;
  return /end user.*not found/i.test(fiskilErrorMessage(raw));
}

export function isFiskilEndUserAlreadyExists(raw: unknown): boolean {
  return fiskilErrorName(raw).includes("already_exists");
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

async function peekJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function fiskilErrorName(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const name = (raw as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

function fiskilErrorMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const message = (raw as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
