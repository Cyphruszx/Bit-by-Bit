/**
 * Spec 4 — guest → account migration.
 *
 * Empty cloud copies the guest. Both sides holding work opens Merge /
 * Keep account only / Replace with guest. Replace is an irreversible wipe
 * and needs the scary confirm phrase. Fingerprint and rule disagreements
 * become OPEN Review Queue items. Device-to-device sync is not this module.
 */

import {
  accountKindOf,
  canonicalAccountId,
  type AccountKind,
  type AccountMeta,
} from "@/lib/money-flow/account-identity";
import {
  migrateQuotas,
  type QuotaStore,
} from "@/lib/money-flow/core-ingest";
import {
  fingerprintOf,
  type Ledger,
  type LedgerEntry,
  type LedgerMigration,
} from "@/lib/money-flow/ledger";
import { isUserOverridden, kindOf } from "@/lib/money-flow/movement-kind";
import type { ReviewItem } from "@/lib/money-flow/review-queue";
import type { LearnedRule, Rules } from "@/lib/money-flow/rules";
import { DEFAULT_SHELL, mergeShells, persistable, type ShellState } from "@/lib/shell/core-shell";

export const REPLACE_CONFIRM_PHRASE = "REPLACE WITH GUEST";

export type MigrationAction = "merge" | "keep-account" | "replace-guest";

export type MigrationAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  externalId?: string;
};

export type AccountPick = {
  guest: MigrationAccount;
  candidates: MigrationAccount[];
};

export type AccountMatchResult = {
  mapped: Record<string, string>;
  needsPick: AccountPick[];
};

export type MigrationKind = "copy-guest" | "keep-account" | "choose" | "already-done";

export type MigrationOffer = {
  kind: MigrationKind;
  guest: Ledger;
  account: Ledger;
  guestId: string;
  matches: AccountMatchResult;
  guestShell: ShellState;
  accountShell: ShellState;
};

export type MigrationDecision =
  | { action: "merge"; accountMatches?: Record<string, string> }
  | { action: "keep-account" }
  | { action: "replace-guest"; confirm: string };

export type MigrationResult = {
  ledger: Ledger;
  shell: ShellState;
  review: ReviewItem[];
};

export function alreadyMigrated(account: Ledger, guestId: string): boolean {
  return account.migration?.status === "done" && account.migration.fromGuestId === guestId;
}

export function holdsMigratable(ledger: Ledger, shell: ShellState = DEFAULT_SHELL): boolean {
  if (ledger.entries.length > 0 || ledger.imports.length > 0) return true;
  if (ledger.rules && Object.keys(ledger.rules).length > 0) return true;
  if (ledger.accounts && Object.keys(ledger.accounts).length > 0) return true;
  return (
    shell.enabled.goals ||
    shell.enabled.linkedBalances ||
    shell.goals.length > 0 ||
    shell.linkedAccountIds.length > 0
  );
}

export function inspectMigration(
  guest: Ledger,
  account: Ledger,
  guestId: string,
  guestShell: ShellState = DEFAULT_SHELL,
  accountShell: ShellState = DEFAULT_SHELL,
): MigrationOffer {
  const matches = matchAccounts(accountsOf(guest), accountsOf(account));
  const offer = {
    guest,
    account,
    guestId,
    matches,
    guestShell,
    accountShell,
  };
  if (alreadyMigrated(account, guestId)) return { ...offer, kind: "already-done" };
  const guestHas = holdsMigratable(guest, guestShell);
  const accountHas = holdsMigratable(account, accountShell);
  if (guestHas && accountHas) return { ...offer, kind: "choose" };
  if (guestHas) return { ...offer, kind: "copy-guest" };
  return { ...offer, kind: "keep-account" };
}

export function applyGuestMigration(
  offer: MigrationOffer,
  decision: MigrationDecision,
): { ok: true; result: MigrationResult } | { ok: false; reason: string } {
  if (offer.kind === "already-done") {
    return { ok: true, result: keepAccount(offer) };
  }
  if (decision.action === "replace-guest") {
    if (decision.confirm !== REPLACE_CONFIRM_PHRASE) {
      return {
        ok: false,
        reason: `Replace with guest is irreversible. Type ${REPLACE_CONFIRM_PHRASE} to confirm.`,
      };
    }
    return { ok: true, result: replaceWithGuest(offer) };
  }
  if (decision.action === "keep-account") {
    return { ok: true, result: keepAccount(offer) };
  }
  return { ok: true, result: mergeGuestIntoAccount(offer, decision.accountMatches ?? {}) };
}

export function stampMigration(ledger: Ledger, guestId: string, at: string = new Date().toISOString()): Ledger {
  const migration: LedgerMigration = { status: "done", fromGuestId: guestId, at };
  return { ...ledger, migration };
}

export function applyQuotaMigration(store: QuotaStore, guestId: string, userId: string, at?: Date) {
  return migrateQuotas(store, guestId, userId, at);
}

export function accountsOf(ledger: Ledger): MigrationAccount[] {
  const mergedInto = ledger.mergedInto ?? {};
  const ids = new Set<string>();
  for (const id of Object.keys(ledger.accounts ?? {})) ids.add(canonicalAccountId(id, mergedInto));
  for (const id of Object.keys(ledger.accountMeta ?? {})) ids.add(canonicalAccountId(id, mergedInto));
  for (const entry of ledger.entries) {
    const raw = entry.accountId?.trim() || entry.accountKey?.trim();
    if (raw) ids.add(canonicalAccountId(raw, mergedInto));
  }
  return [...ids].sort().map((id) => {
    const meta = ledger.accountMeta?.[id];
    return {
      id,
      name: (ledger.accounts?.[id] ?? id).trim(),
      kind: accountKindOf(id, ledger.accountMeta),
      ...(meta?.externalId ? { externalId: meta.externalId } : {}),
    };
  });
}

/**
 * external_id → unique name+type → leftover same-name rows need a user pick.
 */
export function matchAccounts(guest: MigrationAccount[], account: MigrationAccount[]): AccountMatchResult {
  const mapped: Record<string, string> = {};
  const taken = new Set<string>();
  const leftover = new Set(guest.map((row) => row.id));

  for (const side of guest) {
    if (!side.externalId) continue;
    const hits = account.filter((row) => row.externalId === side.externalId);
    if (hits.length === 1 && !taken.has(hits[0].id)) {
      mapped[side.id] = hits[0].id;
      taken.add(hits[0].id);
      leftover.delete(side.id);
    }
  }

  const needsPick: AccountPick[] = [];
  for (const side of guest) {
    if (!leftover.has(side.id)) continue;
    const unique = account.filter(
      (row) => !taken.has(row.id) && sameName(row, side) && row.kind === side.kind,
    );
    if (unique.length === 1) {
      mapped[side.id] = unique[0].id;
      taken.add(unique[0].id);
      leftover.delete(side.id);
      continue;
    }
    const named = account.filter((row) => !taken.has(row.id) && sameName(row, side));
    if (named.length > 0) {
      needsPick.push({ guest: side, candidates: named });
      leftover.delete(side.id);
    }
  }

  return { mapped, needsPick };
}

function sameName(a: MigrationAccount, b: MigrationAccount): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

function keepAccount(offer: MigrationOffer): MigrationResult {
  const ledger = stampMigration(offer.account, offer.guestId);
  const shell = persistable(offer.accountShell);
  return { ledger: { ...ledger, shell }, shell, review: ledger.review ?? [] };
}

function replaceWithGuest(offer: MigrationOffer): MigrationResult {
  const ledger = stampMigration(offer.guest, offer.guestId);
  const shell = persistable(offer.guestShell);
  return { ledger: { ...ledger, shell }, shell, review: ledger.review ?? [] };
}

function mergeGuestIntoAccount(offer: MigrationOffer, userPicks: Record<string, string>): MigrationResult {
  const mapped = { ...offer.matches.mapped, ...userPicks };
  const remappedGuest = remapGuestAccounts(offer.guest, mapped);
  const merged = mergeAfterMatch(remappedGuest, offer.account);
  const shell = mergeShells(offer.guestShell, offer.accountShell, mapped);
  const stamped = stampMigration({ ...merged, shell }, offer.guestId);
  return { ledger: stamped, shell, review: stamped.review ?? [] };
}

export function remapGuestAccounts(guest: Ledger, guestToAccount: Record<string, string>): Ledger {
  const proposed = { ...(guest.mergedInto ?? {}) };
  for (const [from, to] of Object.entries(guestToAccount)) {
    if (from && to && from !== to) proposed[from] = to;
  }
  const mergedInto: Record<string, string> = {};
  for (const from of Object.keys(proposed)) {
    const to = canonicalAccountId(from, proposed);
    if (to !== from) mergedInto[from] = to;
  }

  const collapsed = new Map<string, LedgerEntry>();
  for (const entry of guest.entries) {
    const filing = entry.accountId?.trim() || entry.accountKey?.trim();
    const nextAccountId = filing ? canonicalAccountId(filing, mergedInto) : filing;
    const occurrence = fingerprintOccurrence(entry.fingerprint);
    const next: LedgerEntry = {
      ...entry,
      ...(nextAccountId ? { accountId: nextAccountId } : {}),
      fingerprint: fingerprintOf(
        { ...entry, ...(nextAccountId ? { accountId: nextAccountId } : {}) },
        occurrence,
        mergedInto,
      ),
    };
    const held = collapsed.get(next.fingerprint);
    if (!held) {
      collapsed.set(next.fingerprint, next);
      continue;
    }
    collapsed.set(next.fingerprint, preferOverride(held, next));
  }

  return {
    ...guest,
    mergedInto: Object.keys(mergedInto).length > 0 ? mergedInto : guest.mergedInto,
    entries: [...collapsed.values()],
    ...(guest.accounts ? { accounts: remapRecord(guest.accounts, mergedInto) } : {}),
    ...(guest.accountMeta ? { accountMeta: remapRecord(guest.accountMeta, mergedInto) } : {}),
  };
}

function mergeAfterMatch(guest: Ledger, account: Ledger): Ledger {
  const review: ReviewItem[] = [...(account.review ?? []), ...(guest.review ?? [])];
  const entries = new Map<string, LedgerEntry>();

  for (const entry of account.entries) entries.set(entry.fingerprint, entry);
  for (const entry of guest.entries) {
    const held = entries.get(entry.fingerprint);
    if (!held) {
      entries.set(entry.fingerprint, entry);
      continue;
    }
    const picked = pickFingerprint(entry, held);
    entries.set(entry.fingerprint, picked.entry);
    if (picked.conflict) review.push(picked.conflict);
  }

  const imports = new Map(account.imports.map((record) => [record.id, record]));
  for (const record of guest.imports) {
    if (!imports.has(record.id)) imports.set(record.id, record);
  }

  const rulesMerge = mergeMigrateRules(guest.rules, account.rules);
  review.push(...rulesMerge.conflicts);

  const mergedInto = { ...(account.mergedInto ?? {}), ...(guest.mergedInto ?? {}) };
  const seen = new Set<string>();
  const uniqueReview = review.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return {
    version: account.version || guest.version,
    entries: [...entries.values()],
    imports: [...imports.values()],
    ...(named({ ...(guest.institutions ?? {}), ...(account.institutions ?? {}) }, "institutions")),
    ...(named({ ...(guest.accounts ?? {}), ...(account.accounts ?? {}) }, "accounts")),
    ...(named({ ...(guest.payers ?? {}), ...(account.payers ?? {}) }, "payers")),
    ...(Object.keys(mergedInto).length > 0 ? { mergedInto } : {}),
    ...mergedAccountMeta(guest.accountMeta, account.accountMeta),
    ...mergedVerdicts(guest.verdicts, account.verdicts),
    ...(Object.keys(rulesMerge.rules).length > 0 ? { rules: rulesMerge.rules } : {}),
    ...(account.taxonomy ?? guest.taxonomy ? { taxonomy: account.taxonomy ?? guest.taxonomy } : {}),
    ...(uniqueReview.length > 0 ? { review: uniqueReview } : {}),
  };
}

/**
 * One override wins. Both different overrides → FINGERPRINT_CONFLICT (keep cloud).
 * Neither → keep cloud.
 */
export function pickFingerprint(
  guest: LedgerEntry,
  account: LedgerEntry,
): { entry: LedgerEntry; conflict?: ReviewItem } {
  const guestOver = isUserOverridden(guest);
  const accountOver = isUserOverridden(account);
  if (guestOver && !accountOver) return { entry: unionEntry(guest, account) };
  if (accountOver && !guestOver) return { entry: unionEntry(account, guest) };
  if (guestOver && accountOver && overrideSnapshot(guest) !== overrideSnapshot(account)) {
    return {
      entry: unionEntry(account, guest),
      conflict: {
        id: `FINGERPRINT_CONFLICT:${account.fingerprint}`,
        reason: "FINGERPRINT_CONFLICT",
        state: "OPEN",
        movementIds: [account.id],
        label: `Guest and account disagree on ${account.merchant} (${account.dateIso})`,
      },
    };
  }
  return { entry: unionEntry(account, guest) };
}

export function mergeMigrateRules(
  guest: Rules | undefined,
  account: Rules | undefined,
): { rules: Rules; conflicts: ReviewItem[] } {
  const rules: Rules = {};
  const conflicts: ReviewItem[] = [];
  const keys = new Set([...Object.keys(guest ?? {}), ...Object.keys(account ?? {})]);
  for (const key of keys) {
    const guestRule = guest?.[key];
    const accountRule = account?.[key];
    if (!guestRule) {
      rules[key] = accountRule!;
      continue;
    }
    if (!accountRule) {
      rules[key] = guestRule;
      continue;
    }
    if (guestRule.categoryKey === accountRule.categoryKey) {
      rules[key] = laterRule(guestRule, accountRule);
      continue;
    }
    const guestPriority = guestRule.priority ?? 0;
    const accountPriority = accountRule.priority ?? 0;
    if (guestPriority !== accountPriority) {
      rules[key] = guestPriority > accountPriority ? guestRule : accountRule;
      continue;
    }
    conflicts.push({
      id: `RULE_CONFLICT:${key}`,
      reason: "RULE_CONFLICT",
      state: "OPEN",
      movementIds: [],
      label: `Guest and account learned different actions for ${key}`,
    });
  }
  return { rules, conflicts };
}

function laterRule(guest: LearnedRule, account: LearnedRule): LearnedRule {
  return (guest.at || "") >= (account.at || "") ? guest : account;
}

function overrideSnapshot(entry: LedgerEntry): string {
  return JSON.stringify({
    categoryKey: entry.categoryKey,
    type: kindOf(entry.type),
    tags: [...(entry.tags ?? [])].sort(),
    userFlaggedSavings: entry.userFlaggedSavings === true,
  });
}

function unionEntry(winner: LedgerEntry, other: LedgerEntry): LedgerEntry {
  return {
    ...winner,
    importIds: unique([...winner.importIds, ...other.importIds]),
    firstSeen: winner.firstSeen <= other.firstSeen ? winner.firstSeen : other.firstSeen,
  };
}

function preferOverride(held: LedgerEntry, incoming: LedgerEntry): LedgerEntry {
  const keep = isUserOverridden(incoming) && !isUserOverridden(held) ? incoming : held;
  return unionEntry(keep, keep === incoming ? held : incoming);
}

function fingerprintOccurrence(fingerprint: string): number {
  const tail = fingerprint.split("|").pop() ?? "0";
  const n = Number(tail);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function remapRecord<T>(held: Record<string, T>, mergedInto: Record<string, string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(held)) {
    next[canonicalAccountId(key, mergedInto)] = value;
  }
  return next;
}

function named(map: Record<string, string>, key: "institutions" | "accounts" | "payers") {
  return Object.keys(map).length > 0 ? { [key]: map } : {};
}

function mergedAccountMeta(
  guest: Record<string, AccountMeta> | undefined,
  account: Record<string, AccountMeta> | undefined,
) {
  const held = { ...(guest ?? {}), ...(account ?? {}) };
  return Object.keys(held).length > 0 ? { accountMeta: held } : {};
}

function mergedVerdicts(guest: Ledger["verdicts"], account: Ledger["verdicts"]) {
  const held = { ...(guest ?? {}) };
  for (const [key, verdict] of Object.entries(account ?? {})) {
    const other = held[key];
    if (!other || verdict.at >= other.at) held[key] = verdict;
  }
  return Object.keys(held).length > 0 ? { verdicts: held } : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Empty-cloud copy: guest ledger + its shell, stamped. */
export function copyGuestLedger(guest: Ledger, guestId: string, shell: ShellState = DEFAULT_SHELL): MigrationResult {
  const next = stampMigration({ ...guest, shell: persistable(shell) }, guestId);
  return { ledger: next, shell: persistable(shell), review: next.review ?? [] };
}

