import {
  canonicalAccountId,
  mergeBlockedReason,
  mergeWouldCycle,
  type AccountMeta,
  type AccountNames,
} from "@/lib/money-flow/account-identity";
import { isUserOverridden, migrateStoredType } from "@/lib/money-flow/movement-kind";
import { tidyInstitutionName, type InstitutionOverrides } from "@/lib/money-flow/institution";
import { uniqueTransactions } from "@/lib/money-flow/summary";
import { persistStoredTransaction, upgradeTransactions, type StoredTransaction } from "@/lib/money-flow/upgrade";
import { forget, learn, type LearnedRule, type Rules } from "@/lib/money-flow/rules";
import { parseCategoryBook, type CategoryBook } from "@/lib/money-flow/category-book";
import { mergedReview, parseReviewItems, type ReviewItem } from "@/lib/money-flow/review-queue";
import {
  applyReviewUndoParts,
  lastReviewUndo,
  parseReviewUndo,
  pushReviewUndo,
  type ReviewUndoAction,
} from "@/lib/money-flow/review-undo";
import { isCategoryKey, migrateStoredCategory } from "@/lib/money-flow/taxonomy";
import { verdictFor, type Verdict, type Verdicts } from "@/lib/money-flow/verdicts";
import { hasSource } from "@/lib/money-flow/source";
import { persistUploadStatus } from "@/lib/money-flow/core-ingest";
import { mostRecentStatedBalances } from "@/lib/money-flow/statement-balance";
import type { FileInterpretation, FileKind, InterpretedTransaction } from "@/lib/money-flow/types";
import {
  acceptEnableOffer,
  archiveLayoutEntry,
  dismissEnableOffer,
  mergeFeatureToggles,
  parseDashboardLayout,
  parseFeatureOffer,
  parseFeatureToggles,
  restoreLayoutEntry,
  setFeatureEnabled,
  type DashboardLayout,
  type EnableOfferKey,
  type FeatureKey,
  type FeatureOffer,
  type FeatureToggles,
} from "@/lib/money-flow/features";
import {
  applyMergedIntoToPoolMembers,
  migrateGuestPools,
  parsePoolBook,
  poolBookOf,
  type AccountPool,
  type AccountPoolMember,
  type PoolBook,
  type PoolWriteResult,
} from "@/lib/money-flow/pools";

export const LEDGER_VERSION = 1;

export type LedgerEntry = StoredTransaction & {
  fingerprint: string;
  /** Every import that carried this movement, so removing one import cannot drop a row another still covers. */
  importIds: string[];
  firstSeen: string;
};

export type LedgerImport = {
  id: string;
  label: string;
  filename: string;
  importedAt: string;
  kind: FileKind;
  notes: string[];
  contentHash?: string;
  accountKeys: string[];
  from: string;
  to: string;
  rows: number;
  added: number;
  duplicates: number;
  error?: string;
  /** Set when the same file content was imported before, so nothing was read again. */
  repeatOf?: string;
};

export type Ledger = {
  version: number;
  entries: LedgerEntry[];
  imports: LedgerImport[];
  /**
   * The institution a person named for a statement, keyed by that statement. Kept
   * beside the movements rather than on them, so correcting a name never rewrites
   * a movement's identity.
   */
  institutions?: InstitutionOverrides;
  /**
   * The name a person gave each account, against the key its statement filed movements
   * under. Display only — Spec 6c merge is `mergedInto`, not a shared name.
   */
  accounts?: AccountNames;
  /**
   * Spec 6c hard merge: source account id → survivor. Walked for identity and
   * fingerprints. No undo.
   */
  mergedInto?: Record<string, string>;
  /** Optional currency/kind used to enforce Spec 6 hard blocks on merge. */
  accountMeta?: Record<string, AccountMeta>;
  /**
   * What the person said about movements the statements cannot settle — a lender's
   * drawdown that reads as income, money from an account they have not uploaded. Keyed by
   * wording rather than by row, so a verdict survives re-importing the statement.
   */
  verdicts?: Verdicts;
  /**
   * Payers a person has said are one, against the wording each was filed under. A bank
   * writes a payer's name more than one way, and no reading of the words alone can settle
   * whether two wordings are one payer or two.
   */
  payers?: Record<string, string>;
  /**
   * What the app has learned from being corrected, against the merchant it learned it
   * about. Kept beside the movements like everything else a person has said, so it applies
   * to the next statement rather than only to the rows that were on screen at the time.
   */
  rules?: Rules;
  /**
   * The category list a person has edited: groups, names, and the bank labels that hint
   * at each one. Absent while they are still using the usual fourteen.
   */
  taxonomy?: CategoryBook;
  /**
   * Spec 7 Review Queue items the person has already closed. OPEN items are
   * rebuilt from the current movements each read, so they are not stored here.
   */
  review?: ReviewItem[];
  /** Last 1–5 Review resolves, so Undo can restore OPEN / prior kind after reload. */
  reviewUndo?: ReviewUndoAction[];
  /**
   * Spec 11 Soft pools / Pools. Named groups + undoable membership. Display
   * only — pool writes never touch `mergedInto` or fingerprints.
   */
  accountPools?: AccountPool[];
  accountPoolMembers?: AccountPoolMember[];
  /** Spec 5 Core toggles. POOLS / GOALS / LINKED_BALANCES start off. */
  featureToggles?: FeatureToggles;
  featureOffer?: FeatureOffer;
  /** Spec 5 layout archive. Toggle-off hides UI and parks the widget here. */
  dashboardLayout?: DashboardLayout;
};

export type ImportReport = {
  imports: LedgerImport[];
  added: number;
  duplicates: number;
};

export const EMPTY_LEDGER: Ledger = { version: LEDGER_VERSION, entries: [], imports: [] };

export type AppendOptions = {
  importedAt?: string;
  /** Hash per uploaded filename. Lets a renamed re-upload be recognised as the same file. */
  hashes?: Record<string, string>;
};

export type FingerprintInput = {
  id?: string;
  accountId?: string;
  accountKey?: string;
  sourceFile: string;
  dateIso: string;
  amount: number;
  description?: string;
  merchant: string;
};

/**
 * A movement's identity, independent of which file it arrived in. Two statements
 * covering the same week describe the same movement the same way, so the same
 * fingerprint falls out of both and the second one is recognised as already held.
 * Spec 6c walks `merged_into` so a source account files under the survivor.
 */
export function fingerprintOf(
  txn: FingerprintInput,
  occurrence = 0,
  mergedInto: Record<string, string> = {},
): string {
  return [accountOf(txn, mergedInto), txn.dateIso, txn.amount.toFixed(2), hashDescription(describe(txn)), occurrence].join("|");
}

/** Pre-Spec 3 wording part, so a stored fingerprint still matches on first re-import. */
export function legacyFingerprintOf(
  txn: FingerprintInput,
  occurrence = 0,
  mergedInto: Record<string, string> = {},
): string {
  return [accountOf(txn, mergedInto), txn.dateIso, txn.amount.toFixed(2), normalize(describe(txn)), occurrence].join("|");
}

export function accountOf(txn: FingerprintInput, mergedInto: Record<string, string> = {}): string {
  const raw = txn.accountId?.trim() || txn.accountKey?.trim();
  if (raw) return `acct:${normalize(canonicalAccountId(raw, mergedInto))}`;
  return `file:${normalize(txn.sourceFile)}`;
}

export function appendToLedger(
  ledger: Ledger,
  result: { files: FileInterpretation[]; transactions: InterpretedTransaction[] },
  options: AppendOptions = {},
): { ledger: Ledger; report: ImportReport } {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const mergedInto = ledger.mergedInto ?? {};
  const held = new Map(ledger.entries.map((entry) => [entry.fingerprint, entry]));
  const entries = [...ledger.entries];
  const imports: LedgerImport[] = [];

  grouped(result).forEach(({ label, file, rows }, index) => {
    const filename = file?.filename ?? label;
    const contentHash = options.hashes?.[filename];
    const record: LedgerImport = {
      id: `${importedAt}-${index}-${slug(label)}`,
      label,
      filename,
      importedAt,
      kind: file?.kind ?? "unknown",
      notes: file?.notes ?? [],
      ...(contentHash ? { contentHash } : {}),
      ...(file?.processingError ? { error: file.processingError } : {}),
      accountKeys: unique(rows.map((row) => accountOf(row, mergedInto))),
      from: rows.length > 0 ? rows.reduce((min, row) => (row.dateIso < min ? row.dateIso : min), rows[0].dateIso) : "",
      to: rows.length > 0 ? rows.reduce((max, row) => (row.dateIso > max ? row.dateIso : max), rows[0].dateIso) : "",
      rows: rows.length,
      added: 0,
      duplicates: 0,
    };

    if (rows.length === 0) {
      imports.push(record);
      return;
    }

    const repeat = contentHash ? ledger.imports.find((prior) => prior.contentHash === contentHash) : undefined;
    if (repeat) {
      backfillMissingSource(held, rows, mergedInto);
      imports.push({ ...record, duplicates: rows.length, repeatOf: repeat.id });
      return;
    }

    const seen = new Map<string, number>();
    for (const row of rows) {
      const base = fingerprintOf(row, 0, mergedInto);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const fingerprint = occurrence === 0 ? base : fingerprintOf(row, occurrence, mergedInto);

      const existing = lookupHeld(held, row, occurrence, mergedInto);
      if (existing) {
        // Keep the held movement, tags and all, and only note that this import covered it too.
        // Spec 3: user_overridden wins on the same fingerprint.
        applyReimportOverride(existing, row);
        if (!existing.importIds.includes(record.id)) existing.importIds.push(record.id);
        fillSource(existing, row);
        record.duplicates += 1;
        continue;
      }

      const entry: LedgerEntry = {
        ...row,
        status: persistUploadStatus(row.status),
        fingerprint,
        importIds: [record.id],
        firstSeen: importedAt,
      };
      held.set(fingerprint, entry);
      entries.push(entry);
      record.added += 1;
    }

    imports.push(record);
  });

  return {
    ledger: {
      ...ledger,
      version: LEDGER_VERSION,
      entries: sortEntries(entries),
      imports: [...ledger.imports, ...imports],
      ...namedAccountMeta(applyStatedBalances(ledger.accountMeta, result, mergedInto, ledger.entries)),
    },
    report: {
      imports,
      added: imports.reduce((sum, record) => sum + record.added, 0),
      duplicates: imports.reduce((sum, record) => sum + record.duplicates, 0),
    },
  };
}

export type HeldStatement = {
  key: string;
  label: string;
  kind: FileKind;
  notes: string[];
  accountKeys: string[];
  from: string;
  to: string;
  /** Movements the ledger still holds from this statement. */
  movements: number;
  /** How many times it has been uploaded. */
  uploads: number;
  addedAt: string;
  error?: string;
};

/**
 * One row per statement rather than per upload, so uploading the same file again
 * does not read as a second document.
 */
export function heldStatements(ledger: Ledger): HeldStatement[] {
  const byKey = new Map<string, HeldStatement>();
  const importsFor = new Map<string, Set<string>>();

  for (const record of ledger.imports) {
    const key = record.label;
    const ids = importsFor.get(key) ?? new Set<string>();
    ids.add(record.id);
    importsFor.set(key, ids);

    const held = byKey.get(key);
    byKey.set(key, {
      key,
      label: record.label,
      kind: held?.kind ?? record.kind,
      notes: record.notes.length > 0 ? record.notes : (held?.notes ?? []),
      accountKeys: unique([...(held?.accountKeys ?? []), ...record.accountKeys]),
      from: earliest(held?.from, record.from),
      to: latest(held?.to, record.to),
      movements: 0,
      uploads: (held?.uploads ?? 0) + 1,
      addedAt: held?.addedAt ?? record.importedAt,
      ...(record.error ? { error: record.error } : held?.error ? { error: held.error } : {}),
    });
  }

  for (const entry of ledger.entries) {
    for (const [key, ids] of importsFor) {
      if (!entry.importIds.some((id) => ids.has(id))) continue;
      const held = byKey.get(key);
      if (held) held.movements += 1;
      break;
    }
  }

  return [...byKey.values()];
}

/** Removes a statement however many times it was uploaded. */
export function removeStatement(ledger: Ledger, key: string): Ledger {
  const dropped = ledger.imports
    .filter((record) => record.label === key)
    .reduce((next, record) => removeImport(next, record.id), ledger);
  return nameInstitution(dropped, key, "");
}

export function removeImport(ledger: Ledger, importId: string): Ledger {
  const entries: LedgerEntry[] = [];
  for (const entry of ledger.entries) {
    const importIds = entry.importIds.filter((id) => id !== importId);
    if (importIds.length === 0) continue;
    entries.push(importIds.length === entry.importIds.length ? entry : { ...entry, importIds });
  }
  return {
    ...ledger,
    version: LEDGER_VERSION,
    entries,
    imports: ledger.imports.filter((record) => record.id !== importId),
  };
}

/**
 * Records what a person calls an account. An empty name forgets the naming.
 * Naming never merges two accounts and never undoes a hard merge.
 */
export function nameAccount(ledger: Ledger, accountKey: string, name: string): Ledger {
  const called = tidyInstitutionName(name);
  const accounts = { ...ledger.accounts };
  if (called) accounts[accountKey] = called;
  else delete accounts[accountKey];
  return { ...ledger, accounts };
}

export type MergeAccountsResult = { ok: true; ledger: Ledger } | { ok: false; reason: string };

/**
 * Spec 6c hard merge: source → survivor. Remaps stored rows, recomputes fingerprints,
 * collapses collisions to one CLEARED movement with an OPEN DUPLICATE_HOLD, and
 * breaks same-account transfer pairs. No undo.
 */
export function mergeAccounts(ledger: Ledger, sourceId: string, survivorId: string): MergeAccountsResult {
  const source = canonicalAccountId(sourceId.trim(), ledger.mergedInto);
  const survivor = canonicalAccountId(survivorId.trim(), ledger.mergedInto);
  if (!source || !survivor) return { ok: false, reason: "Pick two accounts." };
  if (source === survivor) return { ok: false, reason: "Already the same account." };
  if (mergeWouldCycle(source, survivor, ledger.mergedInto)) {
    return { ok: false, reason: "That merge would loop." };
  }
  const blocked = mergeBlockedReason(source, survivor, ledger.accountMeta);
  if (blocked) return { ok: false, reason: blocked };

  const proposed = { ...(ledger.mergedInto ?? {}), [source]: survivor };
  const mergedInto: Record<string, string> = {};
  for (const from of Object.keys(proposed)) {
    const to = canonicalAccountId(from, proposed);
    if (to !== from) mergedInto[from] = to;
  }

  const remapped: Array<{ entry: LedgerEntry; filing: string }> = ledger.entries.map((entry) => {
    const filing = filingAccount(entry, ledger);
    const nextAccountId = canonicalAccountId(filing, mergedInto) || filing;
    const occurrence = fingerprintOccurrence(entry.fingerprint);
    const next: LedgerEntry = {
      ...entry,
      accountId: nextAccountId,
      fingerprint: fingerprintOf({ ...entry, accountId: nextAccountId }, occurrence, mergedInto),
    };
    return { entry: next, filing };
  });

  const byFingerprint = new Map<string, Array<{ entry: LedgerEntry; filing: string }>>();
  for (const row of remapped) {
    const group = byFingerprint.get(row.entry.fingerprint) ?? [];
    group.push(row);
    byFingerprint.set(row.entry.fingerprint, group);
  }

  const entries: LedgerEntry[] = [];
  const duplicateHolds: ReviewItem[] = [];
  for (const [fingerprint, group] of byFingerprint) {
    if (group.length === 1) {
      entries.push(group[0].entry);
      continue;
    }
    const winner = pickCollisionWinner(group, source, survivor);
    const kept: LedgerEntry = { ...winner.entry, importIds: [...winner.entry.importIds] };
    for (const other of group) {
      if (other.entry.id === kept.id) continue;
      kept.importIds = unique([...kept.importIds, ...other.entry.importIds]);
      applySurvivorOverride(kept, other.entry);
    }
    entries.push(kept);
    duplicateHolds.push({
      id: `DUPLICATE_HOLD:${fingerprint}`,
      reason: "DUPLICATE_HOLD",
      state: "OPEN",
      movementIds: [],
      label: `Merge collapsed a duplicate of ${kept.merchant} on ${kept.dateIso} into one cleared movement`,
    });
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const collapsed = entries.map((entry) => breakSameAccountTransfer(entry, byId, mergedInto));

  const review = [
    ...(ledger.review ?? []).filter((item) => !duplicateHolds.some((hold) => hold.id === item.id)),
    ...duplicateHolds,
  ];

  const remappedPools = applyMergedIntoToPoolMembers(poolBookOf(ledger.accountPools, ledger.accountPoolMembers), mergedInto);

  return {
    ok: true,
    ledger: {
      ...ledger,
      version: LEDGER_VERSION,
      mergedInto,
      entries: sortEntries(collapsed),
      ...(review.length > 0 ? { review } : {}),
      ...poolFields(remappedPools),
      ...namedAccountMeta(remapMergedAccountMeta(ledger.accountMeta, source, survivor)),
    },
  };
}

function filingAccount(entry: LedgerEntry, ledger: Ledger): string {
  const raw = entry.accountId?.trim() || entry.accountKey?.trim();
  if (raw) return canonicalAccountId(raw, ledger.mergedInto ?? {});
  const filed = `${entry.institution?.trim() || "Unknown source"} · ${entry.sourceFile}`;
  return canonicalAccountId(filed, ledger.mergedInto ?? {});
}

function fingerprintOccurrence(fingerprint: string): number {
  const tail = fingerprint.split("|").pop() ?? "0";
  const n = Number(tail);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function pickCollisionWinner(
  group: Array<{ entry: LedgerEntry; filing: string }>,
  source: string,
  survivor: string,
): { entry: LedgerEntry; filing: string } {
  return (
    group.find((row) => row.filing === survivor) ??
    group.find((row) => row.filing !== source) ??
    group[0]
  );
}

function applySurvivorOverride(winner: LedgerEntry, incoming: LedgerEntry): void {
  if (isUserOverridden(winner) || !isUserOverridden(incoming)) return;
  winner.decidedBy = incoming.decidedBy === "said" ? "user_overridden" : incoming.decidedBy;
  if (incoming.userFlaggedSavings) winner.userFlaggedSavings = true;
  if (isUserOverridden(incoming)) {
    winner.type = migrateStoredType(incoming.type) ?? incoming.type;
    winner.categoryKey = incoming.categoryKey;
  }
}

function breakSameAccountTransfer(
  entry: LedgerEntry,
  byId: Map<string, LedgerEntry>,
  mergedInto: Record<string, string>,
): LedgerEntry {
  const pairId = entry.transferPair;
  if (!pairId) return entry;
  const otherId = pairId
    .split("~")
    .find((id) => id && id !== entry.id);
  const other = (otherId ? byId.get(otherId) : undefined) ??
    [...byId.values()].find((row) => row.id !== entry.id && row.transferPair === pairId);
  if (!other) return stripTransferPair(entry);
  const a = canonicalAccountId(entry.accountId ?? entry.accountKey ?? "", mergedInto);
  const b = canonicalAccountId(other.accountId ?? other.accountKey ?? "", mergedInto);
  if (a && b && a === b) return stripTransferPair(entry);
  return entry;
}

function stripTransferPair(entry: LedgerEntry): LedgerEntry {
  const next: LedgerEntry = { ...entry };
  delete next.transferPair;
  if (
    entry.decidedBy === "said" ||
    entry.decidedBy === "user_overridden" ||
    entry.decidedBy === "paired"
  ) {
    next.decidedBy = "unreviewed";
  }
  return next;
}

/**
 * Records the institution a person named for a statement. An empty name forgets
 * it again, so detection takes back over.
 */
export function nameInstitution(ledger: Ledger, statementKey: string, institution: string): Ledger {
  const named = tidyInstitutionName(institution);
  const institutions = { ...ledger.institutions };
  if (named) institutions[statementKey] = named;
  else delete institutions[statementKey];
  return { ...ledger, institutions };
}

/**
 * Records what a person says a movement really is. An empty reason takes the verdict
 * back, and the reader's own reading takes over again.
 */
export function recordVerdict(ledger: Ledger, key: string, verdict: Verdict | null): Ledger {
  const verdicts = { ...ledger.verdicts };
  if (verdict) verdicts[key] = verdict;
  else delete verdicts[key];
  return { ...ledger, verdicts };
}

/**
 * Remembers a correction, so the next statement gets it right without being asked again.
 */
export function recordCorrection(
  ledger: Ledger,
  txn: Pick<InterpretedTransaction, "merchant" | "categoryKey">,
  categoryKey: string,
  at: string,
): Ledger {
  return { ...ledger, rules: learn(ledger.rules ?? {}, txn, categoryKey, at) };
}

/** Takes a learned correction back. The reader's own reading returns on the next read. */
export function forgetCorrection(ledger: Ledger, key: string): Ledger {
  return { ...ledger, rules: forget(ledger.rules ?? {}, key) };
}

/** Records the category list a person has edited, or forgets it so the usual fourteen return. */
export function recordTaxonomy(ledger: Ledger, book: CategoryBook | null): Ledger {
  if (!book) {
    const next = { ...ledger };
    delete next.taxonomy;
    return next;
  }
  return { ...ledger, taxonomy: book };
}

/** Records a closed Review Queue item, an OPEN decline, or a deferred Skip. */
export function recordReview(ledger: Ledger, item: ReviewItem): Ledger {
  const held = (ledger.review ?? []).filter((row) => row.id !== item.id);
  if (item.state !== "OPEN") {
    return { ...ledger, review: [...held, item] };
  }
  const keepOpen =
    (item.declinedCreditIds?.length ?? 0) > 0 ||
    (item.declinedDebitIds?.length ?? 0) > 0 ||
    Boolean(item.deferredAt);
  if (!keepOpen) return { ...ledger, review: held };
  return { ...ledger, review: [...held, item] };
}

export function rememberReviewUndo(ledger: Ledger, action: ReviewUndoAction): Ledger {
  return { ...ledger, reviewUndo: pushReviewUndo(ledger.reviewUndo, action) };
}

export function undoLastReviewAction(ledger: Ledger): Ledger {
  const action = lastReviewUndo(ledger.reviewUndo);
  if (!action) return ledger;
  const nextStack = (ledger.reviewUndo ?? []).slice(0, -1);
  const restored = applyReviewUndoParts(action, {
    review: ledger.review,
    verdicts: ledger.verdicts,
    rules: ledger.rules,
    transactions: ledgerTransactions(ledger),
  });
  const next: Ledger = {
    ...replaceTransactions(ledger, restored.transactions),
    ...(restored.review ? { review: restored.review } : {}),
    ...(restored.verdicts ? { verdicts: restored.verdicts } : {}),
    ...(restored.rules ? { rules: restored.rules } : {}),
    ...(nextStack.length > 0 ? { reviewUndo: nextStack } : {}),
  };
  if (!restored.review) delete next.review;
  if (!restored.verdicts) delete next.verdicts;
  if (!restored.rules) delete next.rules;
  if (nextStack.length === 0) delete next.reviewUndo;
  return next;
}

/**
 * Records that two wordings are one payer. An empty target takes the merge back, and the
 * wordings go back to being read as they were written.
 */
export function recordPayerMerge(ledger: Ledger, from: string, into: string | null): Ledger {
  const payers = { ...ledger.payers };
  if (into && into !== from) payers[from] = into;
  else delete payers[from];
  return { ...ledger, payers };
}

/**
 * Two copies of one ledger, brought together without losing either.
 *
 * This is what makes a backup safe to sync rather than merely safe to restore. A browser
 * and a cloud copy both hold statements, and taking whichever was written last would throw
 * away whatever the other side did — a statement imported on a laptop, an account named on
 * a phone. Nothing here overwrites: a movement in either copy is a movement in the result.
 *
 * Fingerprints do most of the work, because a movement's identity is already decided once
 * at import and is the same wherever it was read. What is left is what a person said about
 * a movement, and those are settled per key rather than per copy, so two devices that
 * named different things both keep their answer.
 */
export function mergeLedgers(mine: Ledger, theirs: Ledger): Ledger {
  const entries = new Map<string, LedgerEntry>();
  for (const entry of [...theirs.entries, ...mine.entries]) {
    const held = entries.get(entry.fingerprint);
    if (!held) {
      entries.set(entry.fingerprint, entry);
      continue;
    }
    // The same movement from both copies. Keep the local reading of it — a tag edited
    // here is the one in front of the person — but remember every import that carried it,
    // or removing a statement on one device would drop rows the other still covers.
    entries.set(entry.fingerprint, {
      ...entry,
      importIds: unique([...held.importIds, ...entry.importIds]),
      firstSeen: earliest(held.firstSeen, entry.firstSeen),
    });
  }

  const imports = new Map<string, LedgerImport>();
  for (const record of [...theirs.imports, ...mine.imports]) imports.set(record.id, record);

  return {
    version: LEDGER_VERSION,
    entries: sortEntries([...entries.values()]),
    imports: [...imports.values()],
    ...named({ ...theirs.institutions, ...mine.institutions }, "institutions"),
    ...named({ ...theirs.accounts, ...mine.accounts }, "accounts"),
    ...named({ ...theirs.payers, ...mine.payers }, "payers"),
    ...named({ ...theirs.mergedInto, ...mine.mergedInto }, "mergedInto"),
    ...mergedAccountMeta(mine.accountMeta, theirs.accountMeta),
    ...mergedVerdicts(mine.verdicts, theirs.verdicts),
    ...mergedRules(mine.rules, theirs.rules),
    ...pickedTaxonomy(mine.taxonomy, theirs.taxonomy),
    ...pickedReview(mine.review, theirs.review),
    ...pickedReviewUndo(mine.reviewUndo, theirs.reviewUndo),
    ...pickedPools(mine, theirs, { ...theirs.mergedInto, ...mine.mergedInto }),
    ...pickedFeatures(mine, theirs),
  };
}

function mergedRules(mine: Rules | undefined, theirs: Rules | undefined) {
  const held = { ...theirs, ...mine };
  return Object.keys(held).length > 0 ? { rules: held } : {};
}

function pickedTaxonomy(mine: CategoryBook | undefined, theirs: CategoryBook | undefined) {
  const held = mine ?? theirs;
  return held ? { taxonomy: held } : {};
}

function pickedReview(mine: ReviewItem[] | undefined, theirs: ReviewItem[] | undefined) {
  const held = mergedReview(mine, theirs);
  return held.length > 0 ? { review: held } : {};
}

function pickedReviewUndo(mine: ReviewUndoAction[] | undefined, theirs: ReviewUndoAction[] | undefined) {
  const mineLast = lastReviewUndo(mine)?.at ?? "";
  const theirsLast = lastReviewUndo(theirs)?.at ?? "";
  const held = mineLast >= theirsLast ? mine : theirs;
  return held && held.length > 0 ? { reviewUndo: held } : {};
}

function pickedPools(mine: Ledger, theirs: Ledger, mergedInto: Record<string, string>) {
  const guest = poolBookOf(theirs.accountPools, theirs.accountPoolMembers);
  const registered = poolBookOf(mine.accountPools, mine.accountPoolMembers);
  if (guest.pools.length === 0 && guest.members.length === 0 && registered.pools.length === 0 && registered.members.length === 0) {
    return {};
  }
  // Spec 4: copy/merge account_pools + account_pool_members and remap account_ids.
  return poolFields(migrateGuestPools(guest, registered, {}, mergedInto));
}

function pickedFeatures(mine: Ledger, theirs: Ledger) {
  const featureToggles = mergeFeatureToggles(mine.featureToggles, theirs.featureToggles);
  const featureOffer = mine.featureOffer ?? theirs.featureOffer;
  const dashboardLayout = mine.dashboardLayout ?? theirs.dashboardLayout;
  return {
    ...(featureToggles ? { featureToggles } : {}),
    ...(featureOffer ? { featureOffer } : {}),
    ...(dashboardLayout ? { dashboardLayout } : {}),
  };
}

function poolFields(book: PoolBook) {
  return {
    ...(book.pools.length > 0 ? { accountPools: book.pools } : {}),
    ...(book.members.length > 0 ? { accountPoolMembers: book.members } : {}),
  };
}

export function recordPoolBook(ledger: Ledger, book: PoolBook): Ledger {
  const next = { ...ledger };
  delete next.accountPools;
  delete next.accountPoolMembers;
  return { ...next, ...poolFields(book) };
}

export function applyPoolWrite(
  ledger: Ledger,
  write: PoolWriteResult,
): { ok: true; ledger: Ledger; softWarning?: string } | { ok: false; reason: string } {
  if (!write.ok) return write;
  return {
    ok: true,
    ledger: recordPoolBook(ledger, write.book),
    ...(write.softWarning ? { softWarning: write.softWarning } : {}),
  };
}

export function recordFeatureToggle(ledger: Ledger, key: FeatureKey, enabled: boolean, now = new Date().toISOString()): Ledger {
  const featureToggles = setFeatureEnabled(ledger.featureToggles, key, enabled);
  const dashboardLayout = enabled
    ? restoreLayoutEntry(ledger.dashboardLayout, key)
    : archiveLayoutEntry(ledger.dashboardLayout, key, now);
  return {
    ...ledger,
    featureToggles,
    ...(Object.keys(dashboardLayout).length > 0 || ledger.dashboardLayout ? { dashboardLayout } : {}),
  };
}

export function recordEnableOfferAccept(ledger: Ledger, keys: readonly EnableOfferKey[], now = new Date().toISOString()): Ledger {
  const accepted = acceptEnableOffer(ledger.featureToggles, keys, now);
  let next: Ledger = { ...ledger, featureToggles: accepted.toggles, featureOffer: accepted.offer };
  for (const key of keys) next = recordFeatureToggle(next, key, true, now);
  return { ...next, featureOffer: accepted.offer };
}

export function recordEnableOfferDismiss(ledger: Ledger, now = new Date().toISOString()): Ledger {
  return { ...ledger, featureOffer: dismissEnableOffer(ledger.featureOffer, now) };
}

/** Only carried when there is something to carry, so an empty ledger stays empty. */
function named(map: Record<string, string>, key: "institutions" | "accounts" | "payers" | "mergedInto") {
  return Object.keys(map).length > 0 ? { [key]: map } : {};
}

function namedAccountMeta(meta: Record<string, AccountMeta>) {
  return Object.keys(meta).length > 0 ? { accountMeta: meta } : {};
}

function applyStatedBalances(
  held: Record<string, AccountMeta> | undefined,
  result: { files: FileInterpretation[]; transactions: InterpretedTransaction[] },
  mergedInto: Record<string, string>,
  existing: LedgerEntry[] = [],
): Record<string, AccountMeta> {
  const next: Record<string, AccountMeta> = { ...held };
  const fromRows = mostRecentStatedBalances([...existing, ...result.transactions], mergedInto);
  for (const [id, amount] of Object.entries(fromRows)) {
    next[id] = { ...next[id], clearedBalance: amount };
  }
  for (const file of result.files) {
    if (file.statedBalance == null) continue;
    const ids = new Set(
      result.transactions
        .filter((txn) => txn.sourceFile === file.filename)
        .map((txn) => canonicalAccountId(txn.accountId?.trim() || txn.accountKey?.trim() || "", mergedInto))
        .filter(Boolean),
    );
    for (const id of ids) {
      if (fromRows[id] != null) continue;
      next[id] = { ...next[id], clearedBalance: file.statedBalance };
    }
  }
  return next;
}

function remapMergedAccountMeta(
  held: Record<string, AccountMeta> | undefined,
  source: string,
  survivor: string,
): Record<string, AccountMeta> {
  const next: Record<string, AccountMeta> = { ...held };
  const from = next[source];
  if (from) {
    next[survivor] = { ...from, ...next[survivor] };
    delete next[source];
  }
  return next;
}

function mergedAccountMeta(
  mine: Record<string, AccountMeta> | undefined,
  theirs: Record<string, AccountMeta> | undefined,
) {
  const held = { ...theirs, ...mine };
  return Object.keys(held).length > 0 ? { accountMeta: held } : {};
}

/**
 * A verdict says when it was given, so the two copies can be told apart on their own
 * evidence rather than on which happened to be saved last. Changing your mind on a phone
 * beats an older answer on a laptop, whichever device syncs first.
 */
function mergedVerdicts(mine: Verdicts | undefined, theirs: Verdicts | undefined) {
  const held: Verdicts = { ...theirs };
  for (const [key, verdict] of Object.entries(mine ?? {})) {
    const other = held[key];
    if (!other || verdict.at >= other.at) held[key] = verdict;
  }
  return Object.keys(held).length > 0 ? { verdicts: held } : {};
}

/**
 * Writes the current category/tag model onto stored rows. Identity, source cells
 * and what a person settled stay put. The same ledger object is returned when
 * every row is already in the new shape, so a load can skip the write.
 */
export function persistTaxonomy(ledger: Ledger): Ledger {
  let changed = false;
  const entries = ledger.entries.map((entry) => {
    const next = persistStoredTransaction(entry);
    if (next === entry) return entry;
    changed = true;
    return {
      ...next,
      fingerprint: entry.fingerprint,
      importIds: entry.importIds,
      firstSeen: entry.firstSeen,
    };
  });
  return changed ? { ...ledger, entries } : ledger;
}

export function ledgerTransactions(ledger: Ledger): InterpretedTransaction[] {
  return upgradeTransactions(ledger.entries);
}

/**
 * The movements to show, which is not always every movement held. A fingerprint is
 * decided once, at import, from what that statement said about itself; two downloads of
 * one account that overlap by a week arrive under two filenames, so the shared week is
 * held twice and neither copy can be dropped without losing the statement it came with.
 *
 * Reading past the overlap instead of rewriting it keeps every stored movement intact and
 * lets the answer improve as identity does: name two statements as one account and their
 * overlap folds away here, with nothing re-imported and no stored row disturbed.
 */
export function visibleTransactions(ledger: Ledger): InterpretedTransaction[] {
  // Read into the current model on the way out rather than rewritten in place, so a ledger
  // stored under the old thirteen tags opens correctly the first time and nobody is walked
  // through a migration. Idempotent, so a ledger already in the new shape pays nothing.
  return uniqueTransactions(upgradeTransactions(ledger.entries), {
    ...(ledger.accounts ? { names: ledger.accounts } : {}),
    ...(ledger.institutions ? { institutions: ledger.institutions } : {}),
    ...(ledger.payers ? { payers: ledger.payers } : {}),
    ...(ledger.mergedInto ? { mergedInto: ledger.mergedInto } : {}),
  });
}

/** Every statement the ledger holds, described the way the document views expect. */
export function importedFiles(ledger: Ledger): FileInterpretation[] {
  const held = new Map<string, FileInterpretation>();
  for (const record of ledger.imports) {
    const existing = held.get(record.label);
    held.set(record.label, {
      filename: record.label,
      fileType: schemaType(record.kind),
      kind: record.kind,
      uploadStatus: record.error ? "failed" : "uploaded",
      processingStatus: record.error ? "failed" : "completed",
      ...(record.error ? { processingError: record.error } : {}),
      transactionCount: (existing?.transactionCount ?? 0) + record.added,
      notes: record.notes,
    });
  }
  return [...held.values()];
}

function schemaType(kind: FileKind): FileInterpretation["fileType"] {
  if (kind === "csv" || kind === "xlsx" || kind === "pdf" || kind === "image") return kind;
  return "other";
}

export function replaceTransactions(ledger: Ledger, transactions: InterpretedTransaction[]): Ledger {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  return {
    ...ledger,
    entries: ledger.entries.map((entry) => {
      const next = byId.get(entry.id);
      return next ? { ...entry, ...next } : entry;
    }),
  };
}

/** Rebuilds a ledger from movements held before imports were tracked. */
export function ledgerFromTransactions(
  transactions: InterpretedTransaction[],
  files: FileInterpretation[],
  importedAt: string,
): Ledger {
  return appendToLedger(EMPTY_LEDGER, { files, transactions }, { importedAt }).ledger;
}

export function parseLedger(value: unknown): Ledger | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Ledger>;
  if (!Array.isArray(raw.entries) || !Array.isArray(raw.imports)) return null;
  const entries = raw.entries.filter(
    (entry): entry is LedgerEntry =>
      Boolean(entry) && typeof entry.fingerprint === "string" && Array.isArray(entry.importIds) && typeof entry.amount === "number",
  );
  const taxonomy = parseCategoryBook(raw.taxonomy);
  const extraKeys = taxonomy?.categories.map((category) => category.key) ?? [];
  const review = parseReviewItems(raw.review);
  const reviewUndo = parseReviewUndo(raw.reviewUndo);
  return {
    version: LEDGER_VERSION,
    entries: sortEntries(entries),
    imports: raw.imports,
    ...(raw.institutions && typeof raw.institutions === "object" ? { institutions: namesOnly(raw.institutions) } : {}),
    ...(raw.accounts && typeof raw.accounts === "object" ? { accounts: namesOnly(raw.accounts) } : {}),
    ...(raw.mergedInto && typeof raw.mergedInto === "object" ? { mergedInto: stringsOnly(raw.mergedInto) } : {}),
    ...(raw.accountMeta && typeof raw.accountMeta === "object"
      ? { accountMeta: accountMetaOnly(raw.accountMeta) }
      : {}),
    ...(raw.verdicts && typeof raw.verdicts === "object" ? { verdicts: verdictsOnly(raw.verdicts) } : {}),
    ...(raw.payers && typeof raw.payers === "object" ? { payers: stringsOnly(raw.payers) } : {}),
    ...(raw.rules && typeof raw.rules === "object" ? { rules: rulesOnly(raw.rules, extraKeys) } : {}),
    ...(taxonomy ? { taxonomy } : {}),
    ...(review.length > 0 ? { review } : {}),
    ...(reviewUndo.length > 0 ? { reviewUndo } : {}),
    ...parsedPools(raw),
    ...parsedFeatures(raw),
  };
}

function parsedPools(raw: Partial<Ledger>) {
  const book = parsePoolBook(raw.accountPools, raw.accountPoolMembers);
  return book ? poolFields(book) : {};
}

function parsedFeatures(raw: Partial<Ledger>) {
  const featureToggles = parseFeatureToggles(raw.featureToggles);
  const featureOffer = parseFeatureOffer(raw.featureOffer);
  const dashboardLayout = parseDashboardLayout(raw.dashboardLayout);
  return {
    ...(featureToggles ? { featureToggles } : {}),
    ...(featureOffer ? { featureOffer } : {}),
    ...(dashboardLayout ? { dashboardLayout } : {}),
  };
}

type Group = { label: string; file?: FileInterpretation; rows: InterpretedTransaction[] };

/**
 * One group per statement, in upload order rather than the order movements happen
 * to be sorted in. A spreadsheet contributes a group per sheet but hashes against
 * the one uploaded file, and a file that yielded nothing still gets a record so the
 * failure is remembered.
 */
function grouped(result: { files: FileInterpretation[]; transactions: InterpretedTransaction[] }): Group[] {
  const groups = new Map<string, InterpretedTransaction[]>();
  for (const txn of result.transactions) {
    const rows = groups.get(txn.sourceFile) ?? [];
    rows.push(txn);
    groups.set(txn.sourceFile, rows);
  }

  const ordered: Group[] = [];
  for (const file of result.files) {
    const labels = [...groups.keys()].filter(
      (label) => label === file.filename || label.startsWith(`${file.filename} · `),
    );
    if (labels.length === 0) {
      ordered.push({ label: file.filename, file, rows: [] });
      continue;
    }
    for (const label of labels) {
      ordered.push({ label, file, rows: groups.get(label) ?? [] });
      groups.delete(label);
    }
  }
  for (const [label, rows] of groups) ordered.push({ label, rows });
  return ordered;
}

/** Keeps only pairs of strings, so a hand-edited or older store cannot skew a total. */
function stringsOnly(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim().length > 0,
    ),
  );
}

/**
 * Keeps only what reads as a verdict, so a hand-edited or older store cannot skew a total.
 *
 * Whether a reason counts is decided here rather than trusted from storage. A stored
 * `{ counts: true, because: "borrowed" }` would otherwise put a loan drawdown back into
 * income, which is the one thing this guard exists to stop, and a reason nobody wrote
 * would be rendered raw at the person.
 */
function verdictsOnly(raw: Record<string, unknown>): Verdicts {
  const held: Verdicts = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const stored = value as Partial<Verdict>;
    if (typeof stored.because !== "string" || typeof stored.at !== "string") continue;
    const known = verdictFor(stored.because, stored.at);
    if (known.because !== stored.because) continue;
    held[key] = known;
  }
  return held;
}

/**
 * Learned corrections read back from storage, checked against the taxonomy as it is now.
 *
 * A rule naming a category that no longer exists is dropped rather than kept: it could
 * never be applied, and leaving it in the learned list would show a person a sentence
 * about their money that is not true.
 */
function rulesOnly(raw: Record<string, unknown>, extraKeys: string[] = []): Rules {
  const held: Rules = {};
  const extras = new Set(extraKeys);
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const stored = value as Partial<LearnedRule>;
    if (typeof stored.categoryKey !== "string") continue;
    const categoryKey = extras.has(stored.categoryKey)
      ? stored.categoryKey
      : migrateStoredCategory(stored.categoryKey).categoryKey;
    if (!(isCategoryKey(categoryKey) || extras.has(categoryKey))) {
      continue;
    }
    held[key] = {
      categoryKey,
      at: typeof stored.at === "string" ? stored.at : "",
      ...(typeof stored.from === "string" ? { from: stored.from } : {}),
    };
  }
  return held;
}

function namesOnly(raw: Record<string, unknown>): InstitutionOverrides {
  return Object.fromEntries(
    Object.entries(raw)
      .filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim().length > 0)
      .map(([key, value]) => [key, tidyInstitutionName(value)]),
  );
}

function accountMetaOnly(raw: Record<string, unknown>): Record<string, AccountMeta> {
  const kinds = new Set(["CHECKING", "SAVINGS", "CREDIT", "LOAN", "MORTGAGE"]);
  const held: Record<string, AccountMeta> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const stored = value as Partial<AccountMeta>;
    const next: AccountMeta = {};
    if (typeof stored.currency === "string" && stored.currency.trim()) next.currency = stored.currency.trim();
    if (typeof stored.kind === "string" && kinds.has(stored.kind)) next.kind = stored.kind as AccountMeta["kind"];
    if (typeof stored.clearedBalance === "number" && Number.isFinite(stored.clearedBalance)) {
      next.clearedBalance = stored.clearedBalance;
    }
    if (typeof stored.externalId === "string" && stored.externalId.trim()) {
      next.externalId = stored.externalId.trim();
    }
    if (next.currency || next.kind || next.clearedBalance != null || next.externalId) held[key] = next;
  }
  return held;
}

/**
 * A re-upload can land source cells on a movement stored before they existed.
 * Working columns stay as they were — source is evidence, not a rewrite.
 */
function lookupHeld(
  held: Map<string, LedgerEntry>,
  row: FingerprintInput,
  occurrence: number,
  mergedInto: Record<string, string>,
): LedgerEntry | undefined {
  const current = fingerprintOf(row, occurrence, mergedInto);
  const existing = held.get(current);
  if (existing) return existing;
  const legacy = legacyFingerprintOf(row, occurrence, mergedInto);
  const old = held.get(legacy);
  if (!old) return undefined;
  held.delete(legacy);
  old.fingerprint = current;
  held.set(current, old);
  return old;
}

function applyReimportOverride(held: LedgerEntry, incoming: InterpretedTransaction): void {
  if (isUserOverridden(held) || !isUserOverridden(incoming)) return;
  held.decidedBy = incoming.decidedBy === "said" ? "user_overridden" : incoming.decidedBy;
  held.type = migrateStoredType(incoming.type) ?? incoming.type;
  held.categoryKey = incoming.categoryKey;
  if (incoming.userFlaggedSavings) held.userFlaggedSavings = true;
}

function backfillMissingSource(
  held: Map<string, LedgerEntry>,
  rows: InterpretedTransaction[],
  mergedInto: Record<string, string>,
): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const base = fingerprintOf(row, 0, mergedInto);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    const existing = lookupHeld(held, row, occurrence, mergedInto);
    if (existing) fillSource(existing, row);
  }
}

function fillSource(existing: LedgerEntry, row: InterpretedTransaction): void {
  if (!hasSource(existing.source) && row.source) existing.source = row.source;
}

function describe(txn: FingerprintInput): string {
  return txn.description?.trim() || txn.merchant;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hashDescription(value: string): string {
  const raw = normalize(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function earliest(a: string | undefined, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string | undefined, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || a.fingerprint.localeCompare(b.fingerprint));
}
