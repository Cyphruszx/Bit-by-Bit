/**
 * Spec 12 Slice 3 ledger upsert: Open Banking → the same ledger as CSV/OCR.
 *
 * Prefer Fiskil `external_id`, else fingerprint. Same txn id updates PENDING→CLEARED
 * in place. Dual ingest keeps one CLEARED survivor + DUPLICATE_HOLD. user_overridden
 * is never overwritten. After upsert, silent same-institution pairing (both CLEARED,
 * known institution) and Spec 7 RQ as today.
 */

import { accountKeyFrom, inferAccountKind, type AccountKind, type AccountMeta } from "@/lib/money-flow/account-identity";
import { isSilentSameInstitutionPair } from "@/lib/money-flow/auto-pairs";
import { interpretMovement } from "@/lib/money-flow/interpret-row";
import { detectInstitution, institutionOf, UNKNOWN_INSTITUTION } from "@/lib/money-flow/institution";
import {
  fingerprintOf,
  legacyFingerprintOf,
  type Ledger,
  type LedgerEntry,
  LEDGER_VERSION,
} from "@/lib/money-flow/ledger";
import { isUserOverridden } from "@/lib/money-flow/movement-kind";
import { buildReviewQueue, type ReviewItem } from "@/lib/money-flow/review-queue";
import { matchTransfers } from "@/lib/money-flow/transfers";
import type { FileKind, InterpretedTransaction } from "@/lib/money-flow/types";
import type { FiskilBankingAccount, FiskilBankingBalance, FiskilBankingTransaction } from "@/lib/fiskil/banking";

export const OPEN_BANKING_INGEST = "OPEN_BANKING" as const;

export type OpenBankingAccountUpsert = {
  externalId: string;
  accountId: string;
  institution: string;
  label: string;
  kind?: AccountKind;
  currency?: string;
  clearedBalance?: number;
};

export type OpenBankingSyncReport = {
  accounts: number;
  added: number;
  updated: number;
  duplicates: number;
  firstSync: boolean;
};

export type UpsertOpenBankingInput = {
  consentId: string;
  accounts: FiskilBankingAccount[];
  transactions: FiskilBankingTransaction[];
  balances?: FiskilBankingBalance[];
  importedAt?: string;
  firstSync?: boolean;
};

export function openBankingSourceFile(consentId: string, fiskilAccountId: string): string {
  return `open-banking://${consentId}/${fiskilAccountId}`;
}

export function institutionFromFiskil(account: FiskilBankingAccount): string {
  const named = account.institutionName?.trim();
  if (named) return detectInstitution({ org: named }) ?? named.slice(0, 40);
  return UNKNOWN_INSTITUTION;
}

export function mapFiskilAccount(
  account: FiskilBankingAccount,
  consentId: string,
  existing: Ledger,
): OpenBankingAccountUpsert {
  const institution = institutionFromFiskil(account);
  const held = accountIdForExternal(existing, account.id);
  const number = normalizeDigits(account.accountNumber);
  const mask = number && number.length <= 4 ? number : maskedTail(account.accountNumber);
  const accountId =
    held ??
    accountKeyFrom({
      institution,
      statement: openBankingSourceFile(consentId, account.id),
      ...(number && number.length >= 5 ? { number } : {}),
      ...(mask && !(number && number.length >= 5) ? { mask } : {}),
      ...(!(number && number.length >= 5) && !mask ? { name: account.name?.trim() || account.id } : {}),
    });
  const balance = undefined;
  return {
    externalId: account.id,
    accountId,
    institution,
    label: account.name?.trim() || account.productName?.trim() || account.id,
    kind: inferAccountKind(`${account.productCategory ?? ""} ${account.name ?? ""} ${account.productName ?? ""}`),
    ...(account.currency ? { currency: account.currency } : {}),
    ...(balance !== undefined ? { clearedBalance: balance } : {}),
  };
}

export function mapFiskilTransaction(
  txn: FiskilBankingTransaction,
  account: OpenBankingAccountUpsert,
  consentId: string,
): InterpretedTransaction {
  const sourceFile = openBankingSourceFile(consentId, txn.accountId);
  const read = interpretMovement({
    id: `ob:${txn.id}`,
    dateIso: txn.dateIso,
    amount: txn.amount,
    directionKnown: true,
    description: txn.description,
    ...(txn.merchant ? { merchant: txn.merchant } : {}),
    ...(txn.category ? { bankCategory: txn.category } : {}),
    accountKey: account.accountId,
    accountId: account.accountId,
    sourceFile,
    confidence: 1,
  });
  return {
    ...read,
    status: txn.status === "PENDING" ? "PENDING" : "CLEARED",
    externalId: txn.id,
    ingestSource: OPEN_BANKING_INGEST,
    institution: account.institution,
    accountId: account.accountId,
    accountKey: account.accountId,
    baseAmount: read.amount,
  };
}

export function upsertOpenBankingLedger(
  ledger: Ledger,
  input: UpsertOpenBankingInput,
): { ledger: Ledger; report: OpenBankingSyncReport } {
  const importedAt = input.importedAt ?? new Date().toISOString();
  const mappedAccounts = input.accounts.map((account) => mapFiskilAccount(account, input.consentId, ledger));
  const byFiskilAccount = new Map(mappedAccounts.map((account) => [account.externalId, account]));
  const balances = new Map((input.balances ?? []).map((row) => [row.accountId, row]));

  let next: Ledger = refreshKnownInstitutions(
    applyAccountUpserts(ledger, mappedAccounts, balances, input.consentId),
    mappedAccounts,
  );
  const mergedInto = next.mergedInto ?? {};
  const heldByFingerprint = new Map(next.entries.map((entry) => [entry.fingerprint, entry]));
  const heldByExternal = indexByExternalId(next.entries);
  const entries = [...next.entries];
  const importId = `${importedAt}-ob-${slug(input.consentId)}`;

  let added = 0;
  let updated = 0;
  let duplicates = 0;
  const duplicateHolds: ReviewItem[] = [];

  for (const raw of input.transactions) {
    const account = byFiskilAccount.get(raw.accountId);
    if (!account) continue;
    const incoming = mapFiskilTransaction(raw, account, input.consentId);

    const byId = incoming.externalId ? heldByExternal.get(incoming.externalId) : undefined;
    if (byId) {
      const settled = updateExistingInPlace(byId, incoming);
      if (settled === "updated") updated += 1;
      continue;
    }

    const fingerprint = fingerprintOf(incoming, 0, mergedInto);
    const existing =
      heldByFingerprint.get(fingerprint) ??
      heldByFingerprint.get(legacyFingerprintOf(incoming, 0, mergedInto));
    if (existing) {
      if (incoming.externalId && !existing.externalId) {
        existing.externalId = incoming.externalId;
        heldByExternal.set(incoming.externalId, existing);
      }
      applyIncomingWithoutOverride(existing, incoming);
      if (!existing.importIds.includes(importId)) existing.importIds.push(importId);
      duplicates += 1;
      if ((existing.status ?? "CLEARED") === "CLEARED") {
        duplicateHolds.push({
          id: `DUPLICATE_HOLD:${existing.fingerprint}`,
          reason: "DUPLICATE_HOLD",
          state: "OPEN",
          movementIds: [existing.id],
          label: `Open Banking matched an existing cleared movement of ${existing.merchant} on ${existing.dateIso}`,
        });
      }
      continue;
    }

    const entry: LedgerEntry = {
      ...incoming,
      fingerprint,
      importIds: [importId],
      firstSeen: importedAt,
    };
    entries.push(entry);
    heldByFingerprint.set(fingerprint, entry);
    if (entry.externalId) heldByExternal.set(entry.externalId, entry);
    added += 1;
  }

  const review = mergeDuplicateHolds(next.review, duplicateHolds);
  next = {
    ...next,
    version: LEDGER_VERSION,
    entries: sortEntries(entries),
    imports: [
      ...next.imports,
      {
        id: importId,
        label: `Open Banking ${input.consentId}`,
        filename: `open-banking://${input.consentId}`,
        importedAt,
        kind: "json" as FileKind,
        notes: [],
        accountKeys: mappedAccounts.map((account) => account.accountId),
        from: input.transactions[0]?.dateIso ?? "",
        to: input.transactions.reduce((max, row) => (row.dateIso > max ? row.dateIso : max), input.transactions[0]?.dateIso ?? ""),
        rows: input.transactions.length,
        added,
        duplicates,
      },
    ],
    ...(review.length > 0 ? { review } : {}),
  };

  next = applySilentSameInstitutionPairs(next);
  next = persistReviewQueue(next);
  return {
    ledger: next,
    report: {
      accounts: mappedAccounts.length,
      added,
      updated,
      duplicates,
      firstSync: input.firstSync === true,
    },
  };
}

export function applySilentSameInstitutionPairs(ledger: Ledger): Ledger {
  const overrides = ledger.institutions ?? {};
  const match = matchTransfers(ledger.entries, {
    institutions: overrides,
    accounts: ledger.accounts,
    mergedInto: ledger.mergedInto,
  });
  if (match.pairs.length === 0) return ledger;

  const byId = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  let changed = false;
  for (const pair of match.pairs) {
    if (!isSilentSameInstitutionPair(pair.debit, pair.credit, overrides)) continue;
    const debit = byId.get(pair.debit.id);
    const credit = byId.get(pair.credit.id);
    if (!debit || !credit) continue;
    if (isUserOverridden(debit) || isUserOverridden(credit)) continue;
    const token = `${debit.id}~${credit.id}`;
    if (debit.transferPair === token && credit.transferPair === token) continue;
    debit.transferPair = token;
    credit.transferPair = token;
    debit.type = "TRANSFER";
    credit.type = "TRANSFER";
    debit.decidedBy = "paired";
    credit.decidedBy = "paired";
    changed = true;
  }
  return changed ? { ...ledger, entries: sortEntries([...byId.values()]) } : ledger;
}

function persistReviewQueue(ledger: Ledger): Ledger {
  const review = buildReviewQueue(ledger.entries, {
    institutions: ledger.institutions,
    accounts: ledger.accounts,
    mergedInto: ledger.mergedInto,
    imports: ledger.imports,
    stored: ledger.review,
  });
  return { ...ledger, ...(review.length > 0 ? { review } : {}) };
}

function applyAccountUpserts(
  ledger: Ledger,
  accounts: OpenBankingAccountUpsert[],
  balances: Map<string, FiskilBankingBalance>,
  consentId: string,
): Ledger {
  const names = { ...ledger.accounts };
  const meta: Record<string, AccountMeta> = { ...ledger.accountMeta };
  const institutions = { ...ledger.institutions };
  for (const account of accounts) {
    names[account.accountId] = account.label;
    const balance = balances.get(account.externalId);
    const cleared = balance?.available ?? balance?.current ?? account.clearedBalance;
    meta[account.accountId] = {
      ...meta[account.accountId],
      externalId: account.externalId,
      ...(account.kind ? { kind: account.kind } : {}),
      ...(account.currency ? { currency: account.currency } : {}),
      ...(typeof cleared === "number" && Number.isFinite(cleared) ? { clearedBalance: cleared } : {}),
    };
    if (account.institution !== UNKNOWN_INSTITUTION) {
      institutions[openBankingSourceFile(consentId, account.externalId)] = account.institution;
    }
  }
  return {
    ...ledger,
    accounts: names,
    accountMeta: meta,
    ...(Object.keys(institutions).length > 0 ? { institutions } : {}),
  };
}

function accountIdForExternal(ledger: Ledger, fiskilAccountId: string): string | undefined {
  for (const [accountId, meta] of Object.entries(ledger.accountMeta ?? {})) {
    if (meta.externalId === fiskilAccountId) return accountId;
  }
  return undefined;
}

function indexByExternalId(entries: LedgerEntry[]): Map<string, LedgerEntry> {
  const held = new Map<string, LedgerEntry>();
  for (const entry of entries) {
    if (entry.externalId) held.set(entry.externalId, entry);
  }
  return held;
}

function updateExistingInPlace(held: LedgerEntry, incoming: InterpretedTransaction): "updated" | "kept" {
  const before = held.status;
  if ((held.status ?? "CLEARED") === "PENDING" && incoming.status === "CLEARED") {
    held.status = "CLEARED";
  }
  if (knownInstitution(incoming.institution) && !knownInstitution(held.institution)) {
    held.institution = incoming.institution;
  }
  if (!isUserOverridden(held) && !held.description && incoming.description) {
    held.description = incoming.description;
  }
  if (incoming.ingestSource) held.ingestSource = incoming.ingestSource;
  if (incoming.externalId) held.externalId = incoming.externalId;
  return before === held.status ? "kept" : "updated";
}

function refreshKnownInstitutions(ledger: Ledger, accounts: OpenBankingAccountUpsert[]): Ledger {
  const known = new Map(accounts.filter((account) => knownInstitution(account.institution)).map((account) => [account.accountId, account.institution]));
  if (known.size === 0) return ledger;
  let changed = false;
  const entries = ledger.entries.map((entry) => {
    const institution = entry.accountId ? known.get(entry.accountId) : undefined;
    if (!institution || knownInstitution(entry.institution)) return entry;
    changed = true;
    return { ...entry, institution };
  });
  return changed ? { ...ledger, entries } : ledger;
}

function knownInstitution(value: string | undefined): boolean {
  const held = value?.trim();
  return Boolean(held) && held !== UNKNOWN_INSTITUTION;
}

function applyIncomingWithoutOverride(held: LedgerEntry, incoming: InterpretedTransaction): void {
  if (isUserOverridden(held)) return;
  if (incoming.ingestSource && !held.ingestSource) held.ingestSource = incoming.ingestSource;
  if (incoming.institution && !held.institution) held.institution = incoming.institution;
}

function mergeDuplicateHolds(stored: ReviewItem[] | undefined, extra: ReviewItem[]): ReviewItem[] {
  const held = new Map((stored ?? []).map((item) => [item.id, item]));
  for (const item of extra) {
    if (!held.has(item.id)) held.set(item.id, item);
  }
  return [...held.values()];
}

function normalizeDigits(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 3 ? digits : undefined;
}

function maskedTail(raw: string | undefined): string | undefined {
  const digits = normalizeDigits(raw);
  if (!digits || digits.length < 3 || digits.length > 4) return undefined;
  return digits;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || a.fingerprint.localeCompare(b.fingerprint));
}
