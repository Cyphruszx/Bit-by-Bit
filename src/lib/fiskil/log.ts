/**
 * Support-safe Fiskil identifiers (go-live developer checklist).
 *
 * When we contact Fiskil Support we need end_user_id, consent_id, session_id,
 * and error_id. This helper is the only logger Open Banking routes and Fiskil
 * client callers should use — it never writes client secrets, tokens, emails,
 * or raw request/response bodies.
 */

export const FISKIL_SUPPORT_ID_KEYS = ["end_user_id", "consent_id", "session_id", "error_id"] as const;

export type FiskilSupportIdKey = (typeof FISKIL_SUPPORT_ID_KEYS)[number];

export type FiskilSupportIds = {
  end_user_id?: string;
  consent_id?: string;
  session_id?: string;
  error_id?: string;
};

export type FiskilLogExtra = {
  status?: number;
  reason?: string;
  error_name?: string;
  retryable?: boolean;
  page?: number;
  action?: string;
};

const EXTRA_DENY = /secret|token|password|authorization|cookie|bearer|email|phone|ssn|raw|body|payload|header|auth_url/i;

export type FiskilLogWriter = (line: string) => void;

let processWriter: FiskilLogWriter = (line) => {
  console.info(line);
};

export function setFiskilLogWriter(write: FiskilLogWriter | undefined): void {
  processWriter = write ?? ((line) => console.info(line));
}

export function asSupportId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function pickFiskilSupportIds(raw: unknown): FiskilSupportIds {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids: FiskilSupportIds = {};
  const endUserId = asSupportId(row.end_user_id) ?? asSupportId(row.endUserId);
  const consentId = asSupportId(row.consent_id) ?? asSupportId(row.consentId);
  const sessionId = asSupportId(row.session_id) ?? asSupportId(row.sessionId);
  const errorId =
    asSupportId(row.error_id) ??
    asSupportId(row.errorId) ??
    errorIdFromBody(row);
  if (endUserId) ids.end_user_id = endUserId;
  if (consentId) ids.consent_id = consentId;
  if (sessionId) ids.session_id = sessionId;
  if (errorId) ids.error_id = errorId;
  return ids;
}

export function mergeFiskilSupportIds(...parts: Array<FiskilSupportIds | undefined>): FiskilSupportIds {
  const merged: FiskilSupportIds = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.end_user_id) merged.end_user_id = part.end_user_id;
    if (part.consent_id) merged.consent_id = part.consent_id;
    if (part.session_id) merged.session_id = part.session_id;
    if (part.error_id) merged.error_id = part.error_id;
  }
  return merged;
}

export function logFiskilSupport(
  event: string,
  ids: FiskilSupportIds = {},
  extra: FiskilLogExtra = {},
  write: FiskilLogWriter = processWriter,
): FiskilSupportIds {
  const safeIds = pickFiskilSupportIds(ids);
  const line: Record<string, unknown> = { event };
  for (const key of FISKIL_SUPPORT_ID_KEYS) {
    const value = safeIds[key];
    if (value) line[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || EXTRA_DENY.test(key)) continue;
    line[key] = value;
  }
  write(JSON.stringify(line));
  return safeIds;
}

function errorIdFromBody(row: Record<string, unknown>): string | undefined {
  const id = asSupportId(row.id);
  if (!id) return undefined;
  if (id.startsWith("err_")) return id;
  if (typeof row.name === "string" || typeof row.message === "string") return id;
  return undefined;
}
