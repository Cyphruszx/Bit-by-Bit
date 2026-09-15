/**
 * Spec 11 Soft pools / Pools.
 *
 * Named groups with undoable membership. Never hard-merge, never rewrite
 * fingerprints, never change account_id. Cash in pool is a display Σ of stored
 * CHECKING/SAVINGS `cleared_balance` only — not Net Worth, not Actual Savings.
 */

import {
  accountKindOf,
  canonicalAccountId,
  clearedBalanceOf,
  inferAccountCurrency,
  isCashAccountKind,
  type AccountMeta,
} from "@/lib/money-flow/account-identity";

/** Soft warning once the person has this many live pools. Empty pools still count. */
export const POOL_SOFT_LIMIT = 20;

export const CASH_IN_POOL_LABEL = "Cash in pool";
export const POOLS_TITLE = "Pools";
export const NOT_ACTUAL_SAVINGS = "Not Actual Savings.";
export const POOL_OVERLAP_DISCLOSE =
  "Accounts can sit in more than one pool; cash figures can overlap — not Net Worth.";

/**
 * `account_pools` (Spec 11). Stored on the ledger document so Spec 4 guest
 * migrate is a structured copy/merge, matching the rest of the guest store.
 */
export type AccountPool = {
  id: string;
  userId: string;
  name: string;
  notes?: string;
  colour?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/** `account_pool_members` — unique (pool_id, account_id). */
export type AccountPoolMember = {
  poolId: string;
  accountId: string;
  addedAt: string;
};

export type PoolBook = {
  pools: AccountPool[];
  members: AccountPoolMember[];
};

export const EMPTY_POOL_BOOK: PoolBook = { pools: [], members: [] };

export type PoolWriteResult =
  | { ok: true; book: PoolBook; softWarning?: string }
  | { ok: false; reason: string };

export function livePools(book: PoolBook): AccountPool[] {
  return book.pools
    .filter((pool) => !pool.deletedAt)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export function poolById(book: PoolBook, poolId: string): AccountPool | undefined {
  return book.pools.find((pool) => pool.id === poolId);
}

export function membersOf(book: PoolBook, poolId: string): AccountPoolMember[] {
  return book.members
    .filter((member) => member.poolId === poolId)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.accountId.localeCompare(b.accountId));
}

export function poolsForAccount(book: PoolBook, accountId: string): AccountPool[] {
  const ids = new Set(
    book.members.filter((member) => member.accountId === accountId).map((member) => member.poolId),
  );
  return livePools(book).filter((pool) => ids.has(pool.id));
}

export function accountSitsInMultiplePools(book: PoolBook, accountId: string): boolean {
  return poolsForAccount(book, accountId).length > 1;
}

export function hasMultiPoolOverlap(book: PoolBook): boolean {
  const counts = new Map<string, number>();
  for (const member of book.members) {
    const pool = poolById(book, member.poolId);
    if (!pool || pool.deletedAt) continue;
    counts.set(member.accountId, (counts.get(member.accountId) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

export function createPool(
  book: PoolBook,
  input: {
    id?: string;
    userId: string;
    name: string;
    notes?: string;
    colour?: string;
    sortOrder?: number;
    now?: string;
  },
): PoolWriteResult & { pool?: AccountPool } {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "Name a pool." };
  const now = input.now ?? new Date().toISOString();
  const sortOrder =
    input.sortOrder ?? livePools(book).reduce((max, pool) => Math.max(max, pool.sortOrder ?? 0), 0) + 1;
  const pool: AccountPool = {
    id: input.id ?? newId(),
    userId: input.userId,
    name,
    createdAt: now,
    updatedAt: now,
    sortOrder,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.colour?.trim() ? { colour: input.colour.trim() } : {}),
  };
  const next = { ...book, pools: [...book.pools, pool] };
  const live = livePools(next).length;
  return {
    ok: true,
    book: next,
    pool,
    ...(live >= POOL_SOFT_LIMIT
      ? { softWarning: `You have ${live} pools. That is a lot to keep track of.` }
      : {}),
  };
}

export function renamePool(book: PoolBook, poolId: string, name: string, now = new Date().toISOString()): PoolWriteResult {
  const called = name.trim();
  if (!called) return { ok: false, reason: "Name a pool." };
  return updatePool(book, poolId, { name: called }, now);
}

export function updatePool(
  book: PoolBook,
  poolId: string,
  patch: Partial<Pick<AccountPool, "name" | "notes" | "colour" | "sortOrder">>,
  now = new Date().toISOString(),
): PoolWriteResult {
  const held = poolById(book, poolId);
  if (!held || held.deletedAt) return { ok: false, reason: "That pool is gone." };
  const pools = book.pools.map((pool) =>
    pool.id === poolId
      ? {
          ...pool,
          ...("name" in patch && patch.name != null ? { name: patch.name } : {}),
          ...("notes" in patch ? { notes: patch.notes?.trim() || undefined } : {}),
          ...("colour" in patch ? { colour: patch.colour?.trim() || undefined } : {}),
          ...("sortOrder" in patch ? { sortOrder: patch.sortOrder } : {}),
          updatedAt: now,
        }
      : pool,
  );
  return { ok: true, book: { ...book, pools } };
}

/** Undo a pool: archive it. Members stay; the pool leaves the UI. */
export function archivePool(book: PoolBook, poolId: string, now = new Date().toISOString()): PoolWriteResult {
  const held = poolById(book, poolId);
  if (!held || held.deletedAt) return { ok: false, reason: "That pool is gone." };
  const pools = book.pools.map((pool) =>
    pool.id === poolId ? { ...pool, deletedAt: now, updatedAt: now } : pool,
  );
  return { ok: true, book: { ...book, pools } };
}

export function addPoolMember(
  book: PoolBook,
  poolId: string,
  accountId: string,
  ctx: { meta?: Record<string, AccountMeta>; mergedInto?: Record<string, string>; now?: string } = {},
): PoolWriteResult & { member?: AccountPoolMember } {
  const pool = poolById(book, poolId);
  if (!pool || pool.deletedAt) return { ok: false, reason: "That pool is gone." };
  const raw = accountId.trim();
  if (!raw) return { ok: false, reason: "Pick an account." };

  // Merged sources are not members — file under the Spec 6c survivor.
  const canonical = canonicalAccountId(raw, ctx.mergedInto);
  const blocked = memberCurrencyBlock(book, poolId, canonical, ctx.meta ?? {});
  if (blocked) return { ok: false, reason: blocked };
  if (book.members.some((member) => member.poolId === poolId && member.accountId === canonical)) {
    return { ok: false, reason: "That account is already in this pool." };
  }

  const member: AccountPoolMember = {
    poolId,
    accountId: canonical,
    addedAt: ctx.now ?? new Date().toISOString(),
  };
  return { ok: true, book: { ...book, members: [...book.members, member] }, member };
}

/** Undo membership: drop the member row. The account_id itself is untouched. */
export function removePoolMember(book: PoolBook, poolId: string, accountId: string): PoolWriteResult {
  const canonical = accountId.trim();
  const next = book.members.filter((member) => !(member.poolId === poolId && member.accountId === canonical));
  if (next.length === book.members.length) return { ok: false, reason: "That account is not in this pool." };
  return { ok: true, book: { ...book, members: next } };
}

export function memberCurrencyBlock(
  book: PoolBook,
  poolId: string,
  accountId: string,
  meta: Record<string, AccountMeta>,
): string | null {
  const incoming = inferAccountCurrency(accountId, meta);
  for (const member of membersOf(book, poolId)) {
    const held = inferAccountCurrency(member.accountId, meta);
    if (held !== incoming) {
      return `Cannot add a ${incoming} account to a ${held} pool.`;
    }
  }
  return null;
}

export type CashInPool = {
  /** null → hide / — (no CHECKING/SAVINGS members). */
  amount: number | null;
  cashMemberCount: number;
  missingBalances: boolean;
};

/**
 * Cash in pool: Σ live CLEARED of CHECKING/SAVINGS members only.
 * Prefers accounts.`cleared_balance`. Missing → 0 + hint. Debt never enters.
 * Does not invent Σ(CLEARED movements). Display only.
 */
export function cashInPool(
  book: PoolBook,
  poolId: string,
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): CashInPool {
  const cash = membersOf(book, poolId).filter((member) =>
    isCashAccountKind(accountKindOf(member.accountId, meta)),
  );
  if (cash.length === 0) return { amount: null, cashMemberCount: 0, missingBalances: false };

  let amount = 0;
  let missingBalances = false;
  for (const member of cash) {
    const held = clearedBalanceOf(member.accountId, meta, mergedInto);
    amount += held.amount;
    if (held.missing) missingBalances = true;
  }
  return { amount, cashMemberCount: cash.length, missingBalances };
}

export function memberSignedBalance(
  accountId: string,
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): { amount: number; missing: boolean } {
  return clearedBalanceOf(accountId, meta, mergedInto);
}

/**
 * Spec 4 account matching: rewrite member `account_id`s, then collapse
 * unique (pool_id, account_id) keeping the earliest added_at.
 */
export function remapPoolMemberAccountIds(
  book: PoolBook,
  accountIdMap: Record<string, string>,
): PoolBook {
  if (Object.keys(accountIdMap).length === 0) return book;
  const remapped = book.members.map((member) => ({
    ...member,
    accountId: accountIdMap[member.accountId] ?? member.accountId,
  }));
  return { ...book, members: uniqueMembers(remapped) };
}

/** Walk Spec 6c `merged_into` so a source member files under the survivor. */
export function applyMergedIntoToPoolMembers(
  book: PoolBook,
  mergedInto: Record<string, string>,
): PoolBook {
  if (Object.keys(mergedInto).length === 0) return book;
  const remapped = book.members.map((member) => ({
    ...member,
    accountId: canonicalAccountId(member.accountId, mergedInto),
  }));
  return { ...book, members: uniqueMembers(remapped) };
}

/**
 * Spec 4 guest → registered: copy/merge both tables and remap member account_ids.
 * Pool ops still never write `merged_into` or fingerprints.
 */
export function migrateGuestPools(
  guest: PoolBook,
  registered: PoolBook,
  accountIdMap: Record<string, string> = {},
  mergedInto: Record<string, string> = {},
): PoolBook {
  const theirs = applyMergedIntoToPoolMembers(remapPoolMemberAccountIds(guest, accountIdMap), mergedInto);
  const mine = applyMergedIntoToPoolMembers(remapPoolMemberAccountIds(registered, accountIdMap), mergedInto);
  return mergePoolBooks(mine, theirs, mergedInto);
}

export function mergePoolBooks(
  mine: PoolBook,
  theirs: PoolBook,
  mergedInto: Record<string, string> = {},
): PoolBook {
  const pools = new Map<string, AccountPool>();
  for (const pool of theirs.pools) pools.set(pool.id, pool);
  for (const pool of mine.pools) pools.set(pool.id, pool);
  const members = uniqueMembers([...theirs.members, ...mine.members]);
  return applyMergedIntoToPoolMembers({ pools: [...pools.values()], members }, mergedInto);
}

export function poolBookOf(pools?: AccountPool[], members?: AccountPoolMember[]): PoolBook {
  return { pools: pools ?? [], members: members ?? [] };
}

export function parsePoolBook(rawPools: unknown, rawMembers: unknown): PoolBook | undefined {
  const pools = Array.isArray(rawPools) ? rawPools.map(parsePool).filter((row): row is AccountPool => Boolean(row)) : [];
  const members = Array.isArray(rawMembers)
    ? uniqueMembers(rawMembers.map(parseMember).filter((row): row is AccountPoolMember => Boolean(row)))
    : [];
  if (pools.length === 0 && members.length === 0) return undefined;
  return { pools, members };
}

function parsePool(raw: unknown): AccountPool | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  const userId = text(row.userId) ?? text(row.user_id) ?? "";
  const createdAt = text(row.createdAt) ?? text(row.created_at);
  const updatedAt = text(row.updatedAt) ?? text(row.updated_at);
  if (!id || !name || !createdAt || !updatedAt) return null;
  const notes = text(row.notes);
  const colour = text(row.colour);
  const sortOrder = numberOf(row.sortOrder ?? row.sort_order);
  const deletedAt = text(row.deletedAt) ?? text(row.deleted_at);
  return {
    id,
    userId,
    name,
    createdAt,
    updatedAt,
    ...(notes ? { notes } : {}),
    ...(colour ? { colour } : {}),
    ...(sortOrder != null ? { sortOrder } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function parseMember(raw: unknown): AccountPoolMember | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const poolId = text(row.poolId) ?? text(row.pool_id);
  const accountId = text(row.accountId) ?? text(row.account_id);
  const addedAt = text(row.addedAt) ?? text(row.added_at);
  if (!poolId || !accountId || !addedAt) return null;
  return { poolId, accountId, addedAt };
}

function uniqueMembers(members: AccountPoolMember[]): AccountPoolMember[] {
  const held = new Map<string, AccountPoolMember>();
  for (const member of members) {
    const key = `${member.poolId}\0${member.accountId}`;
    const existing = held.get(key);
    if (!existing || member.addedAt < existing.addedAt) held.set(key, member);
  }
  return [...held.values()];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `pool-${Math.random().toString(36).slice(2, 12)}`;
}
