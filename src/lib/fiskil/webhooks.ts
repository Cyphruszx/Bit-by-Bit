/**
 * Fiskil webhook verification and idempotent receipt (Spec 12 Slice 3).
 *
 * Signature: HMAC-SHA256 of the raw body, secret base64-decoded, digest
 * compared to X-Fiskil-Signature (base64). Docs:
 * https://docs.fiskil.com/data-api/guides/core-concepts/webhooks
 * Event id is `message_id` — process once.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { fiskilWebhookSecret, type FiskilEnv } from "./config";

export const FISKIL_SIGNATURE_HEADER = "x-fiskil-signature";

export const SYNC_WEBHOOK_EVENTS = new Set([
  "banking.accounts.sync.completed",
  "banking.balances.sync.completed",
  "banking.transactions.sync.completed",
  "banking.transactions.basic.sync.completed",
  "banking.transactions.recent.sync.completed",
  "consent.received",
]);

export const STOP_WEBHOOK_EVENTS = new Set(["consent.revoked", "consent.updated", "banking.transactions.sync.failed"]);

export type FiskilWebhookEvent = {
  messageId: string;
  event: string;
  endUserId?: string;
  consentId?: string;
  accountIds: string[];
  publishTime?: string;
};

export type WebhookReceipt = {
  messageId: string;
  receivedAt: string;
  event: string;
};

export type WebhookReceiptStore = {
  get(messageId: string): Promise<WebhookReceipt | undefined>;
  put(receipt: WebhookReceipt): Promise<void>;
};

export function memoryWebhookReceiptStore(): WebhookReceiptStore {
  const byId = new Map<string, WebhookReceipt>();
  return {
    async get(messageId) {
      const held = byId.get(messageId);
      return held ? { ...held } : undefined;
    },
    async put(receipt) {
      byId.set(receipt.messageId, { ...receipt });
    },
  };
}

const processReceipts = memoryWebhookReceiptStore();

export function processWebhookReceiptStore(): WebhookReceiptStore {
  return processReceipts;
}

export function verifyFiskilWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  const provided = signature?.trim();
  if (!provided || !secret) return false;
  const expected = signFiskilWebhook(rawBody, secret);
  return safeEqual(provided, expected);
}

export function signFiskilWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secretBytes(secret)).update(rawBody).digest("base64");
}

export function parseFiskilWebhook(raw: unknown): FiskilWebhookEvent | undefined {
  const body = asRecord(raw);
  const data = asRecord(body.data);
  const messageId = asId(body.message_id);
  const event = asId(data.event) ?? asId(body.event);
  if (!messageId || !event) return undefined;
  const accountIds = Array.isArray(data.account_ids)
    ? data.account_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    : [];
  return {
    messageId,
    event,
    ...(asId(data.end_user_id) ? { endUserId: asId(data.end_user_id) } : {}),
    ...(asId(data.consent_id) ? { consentId: asId(data.consent_id) } : {}),
    accountIds,
    ...(asId(body.publish_time) ? { publishTime: asId(body.publish_time) } : {}),
  };
}

export function webhookTriggersSync(event: string): boolean {
  return SYNC_WEBHOOK_EVENTS.has(event);
}

export function webhookStopsSync(event: string): boolean {
  return event === "consent.revoked" || event === "banking.transactions.sync.failed";
}

export type ReceiveWebhookResult =
  | { ok: true; duplicate: boolean; event: FiskilWebhookEvent }
  | { ok: false; status: 400 | 401 | 503; error: string };

export type ReceiveWebhookDeps = {
  env?: FiskilEnv;
  secret?: string | null;
  receipts: WebhookReceiptStore;
  now?: () => number;
};

export async function receiveFiskilWebhook(
  rawBody: string,
  signature: string | null | undefined,
  deps: ReceiveWebhookDeps,
): Promise<ReceiveWebhookResult> {
  const secret = deps.secret === undefined ? fiskilWebhookSecret(deps.env) : deps.secret;
  if (!secret) return { ok: false, status: 503, error: "Fiskil webhook secret is not configured." };
  if (!verifyFiskilWebhookSignature(rawBody, signature, secret)) {
    return { ok: false, status: 401, error: "Invalid webhook signature." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false, status: 400, error: "Webhook body was not JSON." };
  }
  const event = parseFiskilWebhook(parsed);
  if (!event) return { ok: false, status: 400, error: "Webhook was missing message_id or event." };

  const existing = await deps.receipts.get(event.messageId);
  if (existing) return { ok: true, duplicate: true, event };

  await deps.receipts.put({
    messageId: event.messageId,
    receivedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    event: event.event,
  });
  return { ok: true, duplicate: false, event };
}

function secretBytes(secret: string): Buffer {
  const padded = secret.length % 4 === 0 ? secret : secret;
  try {
    const decoded = Buffer.from(padded, "base64");
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === secret.replace(/=+$/, "")) {
      return decoded;
    }
  } catch {
    // Fall through to raw secret bytes when the Console value is not base64.
  }
  return Buffer.from(secret, "utf8");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
