/**
 * Fiskil banking fetch (Spec 12 Slice 3).
 *
 * GET /v1/banking/accounts and /v1/banking/transactions, keyed by end_user_id.
 * Docs: https://docs.fiskil.com/ — prefer posted datetime, else execution.
 */

import { FISKIL_API_BASE, type FiskilCredentials } from "./config";
import { getFiskilAppToken, type TokenCache } from "./token";

export const FIRST_SYNC_DAYS = 90;
export const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class FiskilAuthError extends Error {
  readonly kind: "consent" | "token";
  readonly status: number;

  constructor(kind: "consent" | "token", status: number, message: string) {
    super(message);
    this.name = "FiskilAuthError";
    this.kind = kind;
    this.status = status;
  }
}

export type FiskilBankingAccount = {
  id: string;
  /** Alternate Fiskil ids so transactions can match `account_id` or `fiskil_id`. */
  aliases?: string[];
  accountNumber?: string;
  bsb?: string;
  name?: string;
  productName?: string;
  productCategory?: string;
  institutionId?: string;
  institutionName?: string;
  consentId?: string;
  currency?: string;
};

export type FiskilBankingTransaction = {
  id: string;
  accountId: string;
  amount: number;
  description: string;
  status: "PENDING" | "POSTED";
  dateIso: string;
  postedAt?: string;
  executionAt?: string;
  merchant?: string;
  category?: string;
};

export type FiskilBankingBalance = {
  accountId: string;
  current?: number;
  available?: number;
};

export type BankingFetchDeps = {
  credentials: FiskilCredentials;
  fetchImpl?: typeof fetch;
  cache?: TokenCache;
  now?: () => number;
  apiBase?: string;
};

export type ListTransactionsInput = {
  endUserId: string;
  accountId?: string;
  from?: string;
  to?: string;
};

export function firstSyncFrom(nowMs: number, days = FIRST_SYNC_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isPendingBankStatus(status: string | undefined): boolean {
  return (status ?? "").trim().toUpperCase() === "PENDING";
}

export async function listFiskilAccounts(
  endUserId: string,
  deps: BankingFetchDeps,
): Promise<FiskilBankingAccount[]> {
  const rows = await fetchAllPages(
    "banking/accounts",
    { end_user_id: endUserId },
    deps,
    (body) => asArray(body, "accounts"),
  );
  return rows.map(parseAccount).filter((row): row is FiskilBankingAccount => Boolean(row));
}

export async function listFiskilTransactions(
  input: ListTransactionsInput,
  deps: BankingFetchDeps,
): Promise<FiskilBankingTransaction[]> {
  const query: Record<string, string> = { end_user_id: input.endUserId };
  if (input.accountId) query.account_id = input.accountId;
  if (input.from) query.from = input.from;
  if (input.to) query.to = input.to;
  const rows = await fetchAllPages(
    "banking/transactions",
    query,
    deps,
    (body) => asArray(body, "transactions"),
  );
  return rows.map(parseTransaction).filter((row): row is FiskilBankingTransaction => Boolean(row));
}

export async function listFiskilBalances(
  endUserId: string,
  deps: BankingFetchDeps,
): Promise<FiskilBankingBalance[]> {
  const rows = await fetchAllPages(
    "banking/balances",
    { end_user_id: endUserId },
    deps,
    (body) => asArray(body, "balances"),
  );
  return rows.map(parseBalance).filter((row): row is FiskilBankingBalance => Boolean(row));
}

export function parseAccount(raw: unknown): FiskilBankingAccount | undefined {
  const row = asRecord(raw);
  const accountId = asId(row.account_id);
  const fiskilId = asId(row.fiskil_id);
  const bareId = asId(row.id);
  const id = accountId ?? bareId ?? fiskilId;
  if (!id) return undefined;
  const aliases = uniqueIds([accountId, bareId, fiskilId]).filter((value) => value !== id);
  const institution = nested(row.institution);
  const name = asId(row.name) ?? asId(row.display_name) ?? asId(row.nickname);
  return {
    id,
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(asId(row.account_number) ? { accountNumber: asId(row.account_number) } : {}),
    ...(asId(row.bsb) ? { bsb: asId(row.bsb) } : {}),
    ...(name ? { name } : {}),
    ...(asId(row.product_name) ? { productName: asId(row.product_name) } : {}),
    ...(asId(row.product_category) ? { productCategory: asId(row.product_category) } : {}),
    ...(asId(row.institution_id) ?? asId(institution.id)
      ? { institutionId: asId(row.institution_id) ?? asId(institution.id) }
      : {}),
    ...(asId(row.institution_name) ?? asId(institution.name) ?? asId(institution.display_name)
      ? { institutionName: asId(row.institution_name) ?? asId(institution.name) ?? asId(institution.display_name) }
      : {}),
    ...(asId(row.consent_id) ? { consentId: asId(row.consent_id) } : {}),
    ...(asId(row.currency) ? { currency: asId(row.currency) } : {}),
  };
}

export function parseTransaction(raw: unknown): FiskilBankingTransaction | undefined {
  const row = asRecord(raw);
  const id = asId(row.id) ?? asId(row.transaction_id) ?? asId(row.fiskil_id);
  const accountId = asId(row.account_id) ?? asId(row.fiskil_account_id);
  if (!id || !accountId) return undefined;
  const amount = signedAmount(row);
  if (amount === undefined) return undefined;
  const postedAt = datetimeOf(row, ["posted", "posted_at", "posting_date_time", "posted_datetime"]);
  const executionAt = datetimeOf(row, ["execution", "execution_at", "execution_date_time", "execution_datetime"]);
  const dateIso = civilDate(postedAt ?? executionAt);
  if (!dateIso) return undefined;
  const description =
    asId(row.description) ?? asId(row.reference) ?? asId(nested(row.merchant).name) ?? "Bank transaction";
  return {
    id,
    accountId,
    amount,
    description,
    status: isPendingBankStatus(asId(row.status)) ? "PENDING" : "POSTED",
    dateIso,
    ...(postedAt ? { postedAt } : {}),
    ...(executionAt ? { executionAt } : {}),
    ...(asId(nested(row.merchant).name) ? { merchant: asId(nested(row.merchant).name) } : {}),
    ...(asId(row.category) ?? asId(nested(row.category).name)
      ? { category: asId(row.category) ?? asId(nested(row.category).name) }
      : {}),
  };
}

export function parseBalance(raw: unknown): FiskilBankingBalance | undefined {
  const row = asRecord(raw);
  const accountId = asId(row.account_id);
  if (!accountId) return undefined;
  const current = moneyOf(row.current_balance ?? row.current ?? nested(row.current).amount);
  const available = moneyOf(row.available_balance ?? row.available ?? nested(row.available).amount);
  return {
    accountId,
    ...(current !== undefined ? { current } : {}),
    ...(available !== undefined ? { available } : {}),
  };
}

async function fetchAllPages(
  path: string,
  query: Record<string, string>,
  deps: BankingFetchDeps,
  pick: (body: unknown) => unknown[],
): Promise<unknown[]> {
  const token = await appToken(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const collected: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL(`${deps.apiBase ?? FISKIL_API_BASE}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set("page[size]", "1000");
    if (after) url.searchParams.set("page[after]", after);
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `${token.tokenType} ${token.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw bankingError(response.status);
    const body = await readJson(response);
    collected.push(...pick(body));
    after = nextPageAfter(body);
    if (!after) break;
  }
  return collected;
}

async function appToken(deps: BankingFetchDeps) {
  try {
    return await getFiskilAppToken({
      credentials: deps.credentials,
      fetchImpl: deps.fetchImpl,
      cache: deps.cache,
      now: deps.now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fiskil token request failed.";
    throw new FiskilAuthError("token", 401, message);
  }
}

function bankingError(status: number): Error {
  if (status === 401 || status === 403) {
    return new FiskilAuthError("consent", status, `Fiskil banking request was refused (${status}).`);
  }
  return new Error(`Fiskil banking request failed (${status}).`);
}

function nextPageAfter(body: unknown): string | undefined {
  const row = asRecord(body);
  const links = nested(row.links);
  const next = asId(links.next) ?? asId(links.after);
  if (!next) return undefined;
  try {
    const url = new URL(next, "https://api.fiskil.com");
    return url.searchParams.get("page[after]") ?? url.searchParams.get("after") ?? undefined;
  } catch {
    return next;
  }
}

function asArray(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  const row = asRecord(body);
  if (Array.isArray(row[key])) return row[key] as unknown[];
  if (Array.isArray(row.data)) return row.data as unknown[];
  return [];
}

function signedAmount(row: Record<string, unknown>): number | undefined {
  const raw = moneyOf(row.amount ?? nested(row.amount).amount);
  if (raw === undefined) return undefined;
  const type = (asId(row.type) ?? asId(row.credit_debit) ?? asId(row.direction) ?? "").toUpperCase();
  if (type === "DEBIT" || type === "OUTFLOW") return -Math.abs(raw);
  if (type === "CREDIT" || type === "INFLOW") return Math.abs(raw);
  return raw;
}

function datetimeOf(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asId(row[key]);
    if (value) return value;
  }
  return undefined;
}

function civilDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function moneyOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nested(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function uniqueIds(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Fiskil banking response was not JSON.");
  }
}
