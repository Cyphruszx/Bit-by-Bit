"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  appendToLedger,
  EMPTY_LEDGER,
  heldStatements,
  importedFiles,
  ledgerTransactions,
  mergeLedgers,
  forgetCorrection,
  nameAccount,
  nameInstitution,
  persistTaxonomy,
  recordCorrection,
  removeStatement as dropStatement,
  recordPayerMerge,
  recordVerdict,
  recordTaxonomy,
  replaceTransactions,
  visibleTransactions,
  type HeldStatement,
  type ImportReport,
  type Ledger,
} from "@/lib/money-flow/ledger";
import { applyBook, resolveBook, type CategoryBook } from "@/lib/money-flow/category-book";
import type { AccountNames } from "@/lib/money-flow/accounts";
import type { InstitutionOverrides } from "@/lib/money-flow/institution";
import { ALL_PERIOD, filterByPeriod, parsePeriod, summarizePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { categorizeMerchant, removeTag, renameTag, sameMerchant, tagMerchant, withCategory, withTags } from "@/lib/money-flow/tags";
import { markRefundLegs } from "@/lib/money-flow/refunds";
import {
  applyVerdicts,
  likeKey,
  oneKey,
  verdictFor,
  verdictKeysFor,
  type VerdictReason,
  type Verdicts,
} from "@/lib/money-flow/verdicts";
import { markTransferLegs } from "@/lib/money-flow/transfers";
import { classify } from "@/lib/money-flow/classify";
import { whatWasLearned, type LearnedThing } from "@/lib/money-flow/rules";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";
import { resolveLedgerStore, type LedgerStore } from "@/lib/store/ledger-store";

const PERIOD_KEY = "bitbybit.period-v1";

type Snapshot = {
  ledger: Ledger;
  ready: boolean;
};

const EMPTY_SNAPSHOT: Snapshot = { ledger: EMPTY_LEDGER, ready: false };

const listeners = new Set<() => void>();
const periodListeners = new Set<() => void>();
let snapshot: Snapshot = EMPTY_SNAPSHOT;
let store: LedgerStore | null = null;
let loading: Promise<void> | null = null;
let cachedPeriodRaw: string | null = null;
let cachedPeriod: PeriodFilter = ALL_PERIOD;

type MoneyFlowState = {
  files: FileInterpretation[];
  statements: HeldStatement[];
  allTransactions: InterpretedTransaction[];
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
  period: PeriodFilter;
  setPeriod: (period: PeriodFilter) => void;
  hasUploads: boolean;
  /** False until the stored ledger has been read, so the UI can wait instead of flashing an empty one. */
  ready: boolean;
  importDocuments: (result: InterpretationResult, hashes?: Record<string, string>) => ImportReport;
  removeStatement: (key: string) => void;
  /** The institution a person named for a statement, keyed by that statement. */
  institutionOverrides: InstitutionOverrides;
  /** Names the bank a statement came from, or clears the name to let detection decide. */
  setStatementInstitution: (statementKey: string, institution: string) => void;
  /** What the person calls each account, against the key its statement filed it under. */
  accountNames: AccountNames;
  /** Names an account. Two keys given the same name become one account. */
  setAccountName: (accountKey: string, name: string) => void;
  /** What the person says a movement really is, keyed by wording rather than by row. */
  verdicts: Verdicts;
  /**
   * Settles one movement, or every movement that reads like it. A null reason takes the
   * verdict back and lets the reader's own reading return.
   */
  setVerdict: (
    txn: InterpretedTransaction,
    reason: VerdictReason | null,
    scope?: "one" | "like",
  ) => void;
  /** Wordings a person has said are one payer, against the wording each was filed under. */
  payers: Record<string, string>;
  /** What the app has learned from being corrected, as sentences a person can undo. */
  learned: LearnedThing[];
  /** Takes one of them back, so the reader's own reading returns. */
  forgetLearned: (key: string) => void;
  /** Joins two wordings, or with a null target, separates them again. */
  mergePayers: (from: string, into: string | null) => void;
  clearInterpretation: () => void;
  /** What one movement was for. A person choosing settles it against every later re-read. */
  setTransactionCategory: (id: string, categoryKey: string) => void;
  /** The same category on every movement of one merchant, however far back it goes. */
  setMerchantCategory: (merchant: string, categoryKey: string) => void;
  setTransactionTags: (id: string, tags: string[]) => void;
  /** The same tags on every movement of one merchant, however far back it goes. */
  setMerchantTags: (merchant: string, tags: string[]) => void;
  renameTagEverywhere: (from: string, to: string) => void;
  removeTagEverywhere: (name: string) => void;
  /** The category list as the person has arranged it, or the usual fourteen. */
  categoryBook: CategoryBook;
  /** Records an edit, or null to restore the usual fourteen. */
  setCategoryBook: (book: CategoryBook | null) => void;
};

const MoneyFlowContext = createContext<MoneyFlowState | null>(null);

export function MoneyFlowProvider({ children }: { children: React.ReactNode }) {
  const held = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
  const period = useSyncExternalStore(subscribePeriod, getPeriod, () => ALL_PERIOD);

  useEffect(() => {
    void hydrate();
  }, []);

  const value = useMemo<MoneyFlowState>(() => {
    // Read past the overlap two downloads of one account share, so a week covered by both
    // is one movement here while both statements keep every row they brought.
    const stored = visibleTransactions(held.ledger);
    // Decided over everything held rather than per statement, because the leg that
    // settles a transfer usually arrives in a statement uploaded weeks later.
    // Two shapes, deliberately: the matchers take the account names as `accounts`, while
    // everything that asks which account a movement belongs to takes them as `names`.
    // Handing one to the other silently drops account naming and merging.
    const names = held.ledger.accounts ?? {};
    const institutions = held.ledger.institutions ?? {};
    const payers = held.ledger.payers ?? {};
    const matching = { institutions, accounts: names };
    const registry = { institutions, names, payers };
    // Transfers first, so money that went to another of the person's own accounts is
    // already accounted for and cannot also read as a payment being reversed.
    // What the person said last: a verdict settles what the statements could not, so it is
    // applied over the reader's own pairing rather than under it.
    // The ladder runs first, because what the person has corrected about a merchant is
    // cheaper and better evidence than anything below it, and because the matchers need a
    // settled category to fall back to when a pair stops holding.
    //
    // Then the pairs, which prove the type and leave the category alone. Then whatever the
    // person said outright, which beats all of it.
    const categoryBook = resolveBook(held.ledger.taxonomy);
    applyBook(categoryBook);
    const allTransactions = applyVerdicts(
      markRefundLegs(markTransferLegs(classify(stored, { rules: held.ledger.rules ?? {} }), matching), matching),
      held.ledger.verdicts ?? {},
      registry,
    );
    return {
      files: importedFiles(held.ledger),
      statements: heldStatements(held.ledger),
      allTransactions,
      transactions: filterByPeriod(allTransactions, period),
      flow: summarizePeriod(allTransactions, period),
      period,
      setPeriod: writePeriod,
      institutionOverrides: held.ledger.institutions ?? {},
      setStatementInstitution,
      accountNames: held.ledger.accounts ?? {},
      setAccountName,
      verdicts: held.ledger.verdicts ?? {},
      setVerdict,
      payers: held.ledger.payers ?? {},
      mergePayers,
      learned: whatWasLearned(held.ledger.rules ?? {}, allTransactions),
      forgetLearned,
      hasUploads: held.ledger.imports.length > 0,
      ready: held.ready,
      importDocuments,
      removeStatement,
      clearInterpretation: clearLedger,
      setTransactionCategory,
      setMerchantCategory,
      setTransactionTags,
      setMerchantTags,
      renameTagEverywhere,
      removeTagEverywhere,
      categoryBook,
      setCategoryBook,
    };
  }, [held, period]);

  return <MoneyFlowContext.Provider value={value}>{children}</MoneyFlowContext.Provider>;
}

export function useMoneyFlow() {
  const value = useContext(MoneyFlowContext);
  if (!value) throw new Error("useMoneyFlow must be used within MoneyFlowProvider");
  return value;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribePeriod(onChange: () => void) {
  periodListeners.add(onChange);
  return () => periodListeners.delete(onChange);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

/**
 * Which read is the current one. A read started for one person must not paint the screen
 * after somebody else has signed in — it would put their statements in front of the wrong
 * person — so a read that is no longer the latest quietly drops what it found.
 */
let reading = 0;

function hydrate(): Promise<void> {
  if (loading) return loading;
  const mine = ++reading;
  loading = resolveLedgerStore()
    .then((resolved) => {
      if (mine !== reading) return null;
      store = resolved;
      return resolved.load();
    })
    .then((stored) => {
      if (mine !== reading || !stored) return;
      // Merged, not chosen. A statement imported while the read was in flight must not be
      // thrown away, and neither must what the read brought back — which after signing in
      // is the backup arriving. mergeLedgers is idempotent on fingerprints, so doing this
      // when the two are the same ledger costs nothing and changes nothing.
      const merged = mergeLedgers(snapshot.ledger, stored);
      const persisted = persistTaxonomy(merged);
      update({
        ledger: persisted,
        ready: true,
      });
      // Older rows are rewritten in the current shape once, so a backup or a later
      // read sees categoryKey and tags rather than Food & Drink / food.groceries.
      if (persisted !== merged && store) void store.save(persisted);
    })
    .catch(() => {
      if (mine === reading) update({ ready: true });
    });
  return loading;
}

/**
 * Re-reads the ledger, which is what signing in or out has to do: the store it should be
 * saving to has changed, and the two copies have not met yet.
 *
 * The screen is emptied first and refilled by whatever the new store returns, rather than
 * being merged into. Signing out that way still shows everything, because the browser's copy
 * is left alone and is what gets read back; signing in as somebody else shows their ledger
 * and not the last person's.
 */
export function rehydrateLedger(): Promise<void> {
  loading = null;
  store = null;
  update({ ledger: EMPTY_LEDGER, ready: false });
  return hydrate();
}

function commit(next: Ledger) {
  update({ ledger: next });
  // Saved through whichever store hydrate settled on. Before that resolves there is
  // nothing on screen to save, because nothing has been read yet.
  if (store) void store.save(next);
  else void hydrate().then(() => store?.save(next));
}

function importDocuments(result: InterpretationResult, hashes?: Record<string, string>): ImportReport {
  const { ledger: next, report } = appendToLedger(snapshot.ledger, result, { hashes });
  commit(next);
  // A new statement usually lands outside whatever month was being viewed.
  if (report.added > 0) writePeriod(ALL_PERIOD);
  return report;
}

function removeStatement(key: string) {
  commit(dropStatement(snapshot.ledger, key));
}

function setStatementInstitution(statementKey: string, institution: string) {
  commit(nameInstitution(snapshot.ledger, statementKey, institution));
}

function setAccountName(accountKey: string, name: string) {
  commit(nameAccount(snapshot.ledger, accountKey, name));
}

function setCategoryBook(book: CategoryBook | null) {
  applyBook(book ? resolveBook(book) : null);
  commit(recordTaxonomy(snapshot.ledger, book));
}

function clearLedger() {
  update({ ledger: EMPTY_LEDGER });
  // Clearing removes the backup too, so "start again" means it on every device rather
  // than leaving a copy to sync straight back.
  if (store) void store.clear();
  else void hydrate().then(() => store?.clear());
}

function getPeriod(): PeriodFilter {
  try {
    const raw = localStorage.getItem(PERIOD_KEY);
    if (raw === cachedPeriodRaw) return cachedPeriod;
    cachedPeriodRaw = raw;
    cachedPeriod = raw ? parsePeriod(JSON.parse(raw)) : ALL_PERIOD;
    return cachedPeriod;
  } catch {
    cachedPeriod = ALL_PERIOD;
    return ALL_PERIOD;
  }
}

function writePeriod(period: PeriodFilter) {
  const raw = JSON.stringify(period);
  localStorage.setItem(PERIOD_KEY, raw);
  cachedPeriodRaw = raw;
  cachedPeriod = period;
  periodListeners.forEach((listener) => listener());
}

/**
 * Re-files one movement, and remembers why.
 *
 * The correction is learned from the first time, silently. A person who has told the app
 * that KFC is a restaurant has told it; asking again next month, or on the next hundred
 * KFC rows, is the app failing to listen rather than being careful. It is reversible from
 * the learned list, which is the part that makes silence fair.
 */
function setTransactionCategory(id: string, categoryKey: string) {
  const row = ledgerTransactions(snapshot.ledger).find((txn) => txn.id === id);
  editWith(
    row ? (ledger) => recordCorrection(ledger, row, categoryKey, new Date().toISOString()) : null,
    (rows) => rows.map((txn) => (txn.id === id ? withCategory(txn, categoryKey) : txn)),
  );
}

function setMerchantCategory(merchant: string, categoryKey: string) {
  const row = ledgerTransactions(snapshot.ledger).find((txn) => sameMerchant(txn.merchant, merchant));
  editWith(
    row ? (ledger) => recordCorrection(ledger, row, categoryKey, new Date().toISOString()) : null,
    (rows) => categorizeMerchant(rows, merchant, categoryKey),
  );
}

function forgetLearned(key: string) {
  commit(forgetCorrection(snapshot.ledger, key));
}

function setTransactionTags(id: string, tags: string[]) {
  edit((rows) => rows.map((txn) => (txn.id === id ? withTags(txn, tags) : txn)));
}

function setVerdict(
  txn: InterpretedTransaction,
  reason: VerdictReason | null,
  scope: "one" | "like" = "one",
) {
  const settings = {
    institutions: snapshot.ledger.institutions ?? {},
    names: snapshot.ledger.accounts ?? {},
    payers: snapshot.ledger.payers ?? {},
  };
  const held = { ...(snapshot.ledger.verdicts ?? {}) };

  // Taking a verdict back has to clear every key it could have been filed under — the row
  // itself, the payer it belongs to now, and the wordings it was filed under before a
  // merge or before words were sorted — or applyVerdicts finds one of the others and the
  // verdict comes straight back.
  for (const stale of verdictKeysFor(txn, settings)) delete held[stale];
  // Settling a whole payer should not leave a single row's older verdict standing over it.
  if (scope === "like") delete held[oneKey(txn, settings)];

  const key = scope === "like" ? likeKey(txn, settings) : oneKey(txn, settings);
  const next = reason ? verdictFor(reason, new Date().toISOString()) : null;
  commit(recordVerdict({ ...snapshot.ledger, verdicts: held }, key, next));
}

function mergePayers(from: string, into: string | null) {
  commit(recordPayerMerge(snapshot.ledger, from, into));
}

function setMerchantTags(merchant: string, tags: string[]) {
  edit((rows) => tagMerchant(rows, merchant, tags));
}

function renameTagEverywhere(from: string, to: string) {
  edit((rows) => renameTag(rows, from, to));
}

function removeTagEverywhere(name: string) {
  edit((rows) => removeTag(rows, name));
}

/** A tag edit only ever lands on a statement the person actually uploaded. */
function edit(change: (rows: InterpretedTransaction[]) => InterpretedTransaction[]) {
  editWith(null, change);
}

/**
 * Changes the movements and what the ledger remembers in one write, so a correction and
 * the thing it taught can never be saved apart from each other.
 */
function editWith(
  remember: ((ledger: Ledger) => Ledger) | null,
  change: (rows: InterpretedTransaction[]) => InterpretedTransaction[],
) {
  const stored = ledgerTransactions(snapshot.ledger);
  if (stored.length === 0) return;
  const taught = remember ? remember(snapshot.ledger) : snapshot.ledger;
  commit(replaceTransactions(taught, change(stored)));
}
