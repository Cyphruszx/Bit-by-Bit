/**
 * Defensive Fiskil API error shapes + retry/backoff (go-live checklist).
 *
 * Live errors look like { id, name, message, temporary?, timeout?, fault? }.
 * Auth UI consent errors use error / errorType. Institution and connectivity
 * failures are retried; 401/403 consent and token failures are not.
 */

import { asSupportId } from "./log";

export const FISKIL_RETRY_ATTEMPTS = 3;
export const FISKIL_RETRY_BASE_MS = 150;

export type FiskilErrorFields = {
  status: number;
  errorId?: string;
  errorName?: string;
  temporary: boolean;
  timeout: boolean;
  fault: boolean;
  retryable: boolean;
};

export class FiskilApiError extends Error {
  readonly status: number;
  readonly errorId?: string;
  readonly errorName?: string;
  readonly temporary: boolean;
  readonly timeout: boolean;
  readonly fault: boolean;
  readonly retryable: boolean;

  constructor(message: string, fields: FiskilErrorFields) {
    super(message);
    this.name = "FiskilApiError";
    this.status = fields.status;
    this.temporary = fields.temporary;
    this.timeout = fields.timeout;
    this.fault = fields.fault;
    this.retryable = fields.retryable;
    if (fields.errorId) this.errorId = fields.errorId;
    if (fields.errorName) this.errorName = fields.errorName;
  }
}

export type ParsedFiskilError = {
  errorId?: string;
  errorName?: string;
  message?: string;
  temporary: boolean;
  timeout: boolean;
  fault: boolean;
};

export function parseFiskilErrorBody(raw: unknown): ParsedFiskilError {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errorId =
    asSupportId(row.error_id) ??
    asSupportId(row.errorId) ??
    asSupportId(row.id);
  const errorName =
    asSupportId(row.name) ??
    asSupportId(row.error_name) ??
    asSupportId(row.errorType) ??
    asSupportId(row.error);
  const message = asSupportId(row.message) ?? asSupportId(row.errorDescription);
  return {
    ...(errorId ? { errorId } : {}),
    ...(errorName ? { errorName: errorName.toLowerCase() } : {}),
    ...(message ? { message } : {}),
    temporary: row.temporary === true,
    timeout: row.timeout === true,
    fault: row.fault === true,
  };
}

export function isRetryableFiskilStatus(status: number, parsed: ParsedFiskilError): boolean {
  if (parsed.temporary || parsed.timeout) return true;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return false;
}

export function fiskilErrorFromResponse(status: number, raw: unknown, action: string): FiskilApiError {
  const parsed = parseFiskilErrorBody(raw);
  const retryable = isRetryableFiskilStatus(status, parsed);
  const label = parsed.errorName ? `${status} ${parsed.errorName}` : String(status);
  return new FiskilApiError(`${action} failed (${label}).`, {
    status,
    temporary: parsed.temporary,
    timeout: parsed.timeout,
    fault: parsed.fault,
    retryable,
    ...(parsed.errorId ? { errorId: parsed.errorId } : {}),
    ...(parsed.errorName ? { errorName: parsed.errorName } : {}),
  });
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof FiskilApiError) return err.retryable;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /network|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(err.message)) {
    return true;
  }
  return false;
}

export function errorIdOf(err: unknown): string | undefined {
  if (err instanceof FiskilApiError) return err.errorId;
  if (err && typeof err === "object" && "errorId" in err) {
    return asSupportId((err as { errorId?: unknown }).errorId);
  }
  return undefined;
}

export type RetryDeps = {
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  baseDelayMs?: number;
};

export async function defaultFiskilSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withFiskilRetry<T>(work: () => Promise<T>, deps: RetryDeps = {}): Promise<T> {
  const attempts = deps.attempts ?? FISKIL_RETRY_ATTEMPTS;
  const sleep = deps.sleep ?? defaultFiskilSleep;
  const base = deps.baseDelayMs ?? FISKIL_RETRY_BASE_MS;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      last = err;
      if (attempt === attempts - 1 || !isRetryableError(err)) throw err;
      await sleep(base * 2 ** attempt);
    }
  }
  throw last;
}
