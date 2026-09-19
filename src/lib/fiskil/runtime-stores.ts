/**
 * Production Open Banking stores: Supabase when the service role is set,
 * process memory only as a last resort for tests / unconfigured local.
 *
 * Memory is not the production path. Vercel serverless instances do not
 * share a Map, so Connect → webhook / poll / Show connections would miss.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  memoryAuthSessionStore,
  memoryConnectionStore,
  processAuthSessionStore,
  processConnectionStore,
  type AuthSessionStore,
  type BankConnection,
  type BankConnectionStatus,
  type ConnectionStore,
  type StoredAuthSession,
} from "./connections";
import { memoryEndUserLinkStore, processEndUserLinkStore, type EndUserLinkStore } from "./end-users";
import {
  durableLedgerDocumentStore,
  memoryLedgerDocumentStore,
  processLedgerDocumentStore,
  type LedgerDocumentRows,
  type LedgerDocumentStore,
} from "./ledger-store";
import { supabaseAdmin, supabaseAdminConfig, type SupabaseAdminEnv } from "@/lib/supabase/admin";
import {
  memoryWebhookReceiptStore,
  processWebhookReceiptStore,
  type WebhookReceipt,
  type WebhookReceiptStore,
} from "./webhooks";

export const OPEN_BANKING_CONNECTIONS_TABLE = "open_banking_connections";
export const OPEN_BANKING_END_USERS_TABLE = "open_banking_end_users";
export const OPEN_BANKING_AUTH_SESSIONS_TABLE = "open_banking_auth_sessions";
export const OPEN_BANKING_WEBHOOK_RECEIPTS_TABLE = "open_banking_webhook_receipts";
export const LEDGERS_TABLE = "ledgers";

export type OpenBankingStores = {
  connections: ConnectionStore;
  endUsers: EndUserLinkStore;
  sessions: AuthSessionStore;
  ledgers: LedgerDocumentStore;
  receipts: WebhookReceiptStore;
};

export function processOpenBankingStores(): OpenBankingStores {
  return {
    connections: processConnectionStore(),
    endUsers: processEndUserLinkStore(),
    sessions: processAuthSessionStore(),
    ledgers: processLedgerDocumentStore(),
    receipts: processWebhookReceiptStore(),
  };
}

export function memoryOpenBankingStores(): OpenBankingStores {
  return {
    connections: memoryConnectionStore(),
    endUsers: memoryEndUserLinkStore(),
    sessions: memoryAuthSessionStore(),
    ledgers: memoryLedgerDocumentStore(),
    receipts: memoryWebhookReceiptStore(),
  };
}

/** True when production should use Supabase, not the process-memory Maps. */
export function usesDurableOpenBankingStores(env: SupabaseAdminEnv = process.env): boolean {
  return supabaseAdminConfig(env) !== null;
}

export function resolveOpenBankingStores(input: {
  durable: OpenBankingStores;
  memory: OpenBankingStores;
  adminConfigured: boolean;
}): OpenBankingStores {
  return input.adminConfigured ? input.durable : input.memory;
}

export function openBankingRuntimeStores(env: SupabaseAdminEnv = process.env): OpenBankingStores {
  const admin = supabaseAdmin(env);
  if (admin) return supabaseOpenBankingStores(admin);
  return processOpenBankingStores();
}

export function supabaseOpenBankingStores(client: SupabaseClient): OpenBankingStores {
  return {
    connections: supabaseConnectionStore(client),
    endUsers: supabaseEndUserLinkStore(client),
    sessions: supabaseAuthSessionStore(client),
    ledgers: durableLedgerDocumentStore(supabaseLedgerDocumentRows(client)),
    receipts: supabaseWebhookReceiptStore(client),
  };
}

export function supabaseLedgerDocumentRows(client: SupabaseClient): LedgerDocumentRows {
  return {
    async read(userId) {
      const { data, error } = await client
        .from(LEDGERS_TABLE)
        .select("document, revision")
        .eq("user_id", userId)
        .maybeSingle<{ document: unknown; revision: number }>();
      if (error) return null;
      return data ?? "absent";
    },
    async insert(userId, document) {
      const { data, error } = await client
        .from(LEDGERS_TABLE)
        .insert({ user_id: userId, document })
        .select("revision")
        .maybeSingle<{ revision: number }>();
      if (error) return null;
      return data?.revision ?? null;
    },
    async update(userId, document, revision) {
      const { data, error } = await client
        .from(LEDGERS_TABLE)
        .update({ document })
        .eq("user_id", userId)
        .eq("revision", revision)
        .select("revision")
        .maybeSingle<{ revision: number }>();
      if (error) return null;
      return data?.revision ?? null;
    },
  };
}

export function supabaseConnectionStore(client: SupabaseClient): ConnectionStore {
  return {
    async listByUserId(userId) {
      const { data, error } = await client
        .from(OPEN_BANKING_CONNECTIONS_TABLE)
        .select("*")
        .eq("user_id", userId);
      if (error) throw new Error(`Could not list bank connections: ${error.message}`);
      return (data ?? []).map(connectionFromRow);
    },
    async listActive() {
      const { data, error } = await client
        .from(OPEN_BANKING_CONNECTIONS_TABLE)
        .select("*")
        .eq("status", "active");
      if (error) throw new Error(`Could not list active bank connections: ${error.message}`);
      return (data ?? []).map(connectionFromRow);
    },
    async getById(id) {
      const { data, error } = await client
        .from(OPEN_BANKING_CONNECTIONS_TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Could not load bank connection: ${error.message}`);
      return data ? connectionFromRow(data) : undefined;
    },
    async getByConsentId(consentId) {
      const needle = consentId.trim();
      const byConsent = await client
        .from(OPEN_BANKING_CONNECTIONS_TABLE)
        .select("*")
        .eq("consent_id", needle)
        .maybeSingle();
      if (byConsent.error) throw new Error(`Could not load bank connection by consent: ${byConsent.error.message}`);
      if (byConsent.data) return connectionFromRow(byConsent.data);
      const byId = await client.from(OPEN_BANKING_CONNECTIONS_TABLE).select("*").eq("id", needle).maybeSingle();
      if (byId.error) throw new Error(`Could not load bank connection by consent: ${byId.error.message}`);
      return byId.data ? connectionFromRow(byId.data) : undefined;
    },
    async listByEndUserId(endUserId) {
      const { data, error } = await client
        .from(OPEN_BANKING_CONNECTIONS_TABLE)
        .select("*")
        .eq("end_user_id", endUserId);
      if (error) throw new Error(`Could not list bank connections for end user: ${error.message}`);
      return (data ?? []).map(connectionFromRow);
    },
    async put(connection) {
      const { error } = await client.from(OPEN_BANKING_CONNECTIONS_TABLE).upsert(connectionToRow(connection));
      if (error) throw new Error(`Could not persist bank connection: ${error.message}`);
    },
  };
}

export function supabaseEndUserLinkStore(client: SupabaseClient): EndUserLinkStore {
  return {
    async getByUserId(userId) {
      const { data, error } = await client
        .from(OPEN_BANKING_END_USERS_TABLE)
        .select("user_id, end_user_id, email")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Could not load Open Banking end-user link: ${error.message}`);
      return data ? endUserFromRow(data) : undefined;
    },
    async getByEndUserId(endUserId) {
      const { data, error } = await client
        .from(OPEN_BANKING_END_USERS_TABLE)
        .select("user_id, end_user_id, email")
        .eq("end_user_id", endUserId)
        .maybeSingle();
      if (error) throw new Error(`Could not load Open Banking end-user link: ${error.message}`);
      return data ? endUserFromRow(data) : undefined;
    },
    async put(link) {
      const { error } = await client.from(OPEN_BANKING_END_USERS_TABLE).upsert({
        user_id: link.userId,
        end_user_id: link.endUserId,
        email: link.email,
      });
      if (error) throw new Error(`Could not persist Open Banking end-user link: ${error.message}`);
    },
  };
}

export function supabaseAuthSessionStore(client: SupabaseClient): AuthSessionStore {
  return {
    async getBySessionId(sessionId) {
      const { data, error } = await client
        .from(OPEN_BANKING_AUTH_SESSIONS_TABLE)
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) throw new Error(`Could not load Open Banking session: ${error.message}`);
      return data ? sessionFromRow(data) : undefined;
    },
    async put(session) {
      const { error } = await client.from(OPEN_BANKING_AUTH_SESSIONS_TABLE).upsert(sessionToRow(session));
      if (error) throw new Error(`Could not persist Open Banking session: ${error.message}`);
    },
  };
}

export function supabaseWebhookReceiptStore(client: SupabaseClient): WebhookReceiptStore {
  return {
    async get(messageId) {
      const { data, error } = await client
        .from(OPEN_BANKING_WEBHOOK_RECEIPTS_TABLE)
        .select("message_id, received_at, event")
        .eq("message_id", messageId)
        .maybeSingle();
      if (error) throw new Error(`Could not load webhook receipt: ${error.message}`);
      return data ? receiptFromRow(data) : undefined;
    },
    async put(receipt) {
      const { error } = await client.from(OPEN_BANKING_WEBHOOK_RECEIPTS_TABLE).upsert({
        message_id: receipt.messageId,
        received_at: receipt.receivedAt,
        event: receipt.event,
      });
      if (error) throw new Error(`Could not persist webhook receipt: ${error.message}`);
    },
  };
}

export function connectionToRow(connection: BankConnection): Record<string, unknown> {
  return {
    id: connection.id,
    user_id: connection.userId,
    end_user_id: connection.endUserId,
    session_id: connection.sessionId,
    consent_id: connection.consentId ?? null,
    status: connection.status,
    created_at: connection.createdAt,
    revoked_at: connection.revokedAt ?? null,
    last_synced_at: connection.lastSyncedAt ?? null,
    last_cursor: connection.lastCursor ?? null,
    first_sync_completed_at: connection.firstSyncCompletedAt ?? null,
    sync_stopped_reason: connection.syncStoppedReason ?? null,
  };
}

export function connectionFromRow(raw: unknown): BankConnection {
  const row = asRecord(raw);
  const status = asConnectionStatus(row.status);
  return {
    id: asText(row.id),
    userId: asText(row.user_id),
    endUserId: asText(row.end_user_id),
    sessionId: asText(row.session_id),
    ...(asOptional(row.consent_id) ? { consentId: asOptional(row.consent_id) } : {}),
    status,
    createdAt: asTime(row.created_at),
    ...(asOptional(row.revoked_at) ? { revokedAt: asTime(row.revoked_at) } : {}),
    ...(asOptional(row.last_synced_at) ? { lastSyncedAt: asTime(row.last_synced_at) } : {}),
    ...(asOptional(row.last_cursor) ? { lastCursor: asText(row.last_cursor) } : {}),
    ...(asOptional(row.first_sync_completed_at) ? { firstSyncCompletedAt: asTime(row.first_sync_completed_at) } : {}),
    ...(row.sync_stopped_reason === "consent" || row.sync_stopped_reason === "token"
      ? { syncStoppedReason: row.sync_stopped_reason }
      : {}),
  };
}

export function sessionToRow(session: StoredAuthSession): Record<string, unknown> {
  return {
    session_id: session.sessionId,
    user_id: session.userId,
    end_user_id: session.endUserId,
    redirect_uri: session.redirectUri,
    cancel_uri: session.cancelUri,
    created_at: session.createdAt,
    expires_at: session.expiresAt ?? null,
    fiskil_id: session.fiskilId ?? null,
    auth_url: session.authUrl ?? null,
    connection_id: session.connectionId ?? null,
  };
}

export function sessionFromRow(raw: unknown): StoredAuthSession {
  const row = asRecord(raw);
  return {
    sessionId: asText(row.session_id),
    userId: asText(row.user_id),
    endUserId: asText(row.end_user_id),
    redirectUri: asText(row.redirect_uri),
    cancelUri: asText(row.cancel_uri),
    createdAt: asTime(row.created_at),
    ...(typeof row.expires_at === "number" ? { expiresAt: row.expires_at } : {}),
    ...(asOptional(row.fiskil_id) ? { fiskilId: asOptional(row.fiskil_id) } : {}),
    ...(asOptional(row.auth_url) ? { authUrl: asOptional(row.auth_url) } : {}),
    ...(asOptional(row.connection_id) ? { connectionId: asOptional(row.connection_id) } : {}),
  };
}

function endUserFromRow(raw: unknown) {
  const row = asRecord(raw);
  return {
    userId: asText(row.user_id),
    endUserId: asText(row.end_user_id),
    email: asText(row.email),
  };
}

function receiptFromRow(raw: unknown): WebhookReceipt {
  const row = asRecord(raw);
  return {
    messageId: asText(row.message_id),
    receivedAt: asTime(row.received_at),
    event: asText(row.event),
  };
}

function asConnectionStatus(value: unknown): BankConnectionStatus {
  if (value === "revoked" || value === "needs_reconnect") return value;
  return "active";
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asTime(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return "";
}
