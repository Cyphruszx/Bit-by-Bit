"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { accounts as demoAccounts, budgets as demoBudgets, goals as demoGoals, transactions as demoTransactions } from "@/lib/demo-data";
import {
  appendToLedger,
  EMPTY_LEDGER,
  heldStatements,
  importedFiles,
  ledgerTransactions,
  nameInstitution,
  removeStatement as dropStatement,
  replaceTransactions,
  type HeldStatement,
  type ImportReport,
  type Ledger,
} from "@/lib/money-flow/ledger";
import type { InstitutionOverrides } from "@/lib/money-flow/institution";
import { parseDate } from "@/lib/money-flow/parse-values";
import { ALL_PERIOD, filterByPeriod, parsePeriod, summarizePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { removeTag, renameTag, tagMerchant, tagsOf, withTags } from "@/lib/money-flow/tags";
import { markTransferLegs } from "@/lib/money-flow/transfers";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";
import { createLedgerStore, type LedgerStore } from "@/lib/store/ledger-store";

const PERIOD_KEY = "bitbybit.period-v1";
const DEMO_TAGS_KEY = "bitbybit.demo-tags-v1";

type Snapshot = {
  ledger: Ledger;
  /** Tag edits made against the sample activity, which never enters the ledger. */
  demoTags: Record<string, string[]>;
  ready: boolean;
};

const EMPTY_SNAPSHOT: Snapshot = { ledger: EMPTY_LEDGER, demoTags: {}, ready: false };

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
  usingDemo: boolean;
  /** False until the stored ledger has been read, so the UI can wait instead of flashing samples. */
  ready: boolean;
  importDocuments: (result: InterpretationResult, hashes?: Record<string, string>) => ImportReport;
  removeStatement: (key: string) => void;
  /** The institution a person named for a statement, keyed by that statement. */
  institutionOverrides: InstitutionOverrides;
  /** Names the bank a statement came from, or clears the name to let detection decide. */
  setStatementInstitution: (statementKey: string, institution: string) => void;
  clearInterpretation: () => void;
  setTransactionTags: (id: string, tags: string[]) => void;
  /** The same tags on every movement of one merchant, however far back it goes. */
  setMerchantTags: (merchant: string, tags: string[]) => void;
  renameTagEverywhere: (from: string, to: string) => void;
  removeTagEverywhere: (name: string) => void;
};

const MoneyFlowContext = createContext<MoneyFlowState | null>(null);

export function MoneyFlowProvider({ children }: { children: React.ReactNode }) {
  const held = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
  const period = useSyncExternalStore(subscribePeriod, getPeriod, () => ALL_PERIOD);

  useEffect(() => {
    void hydrate();
  }, []);

  const value = useMemo<MoneyFlowState>(() => {
    const stored = ledgerTransactions(held.ledger);
    // Decided over everything held rather than per statement, because the leg that
    // settles a transfer usually arrives in a statement uploaded weeks later.
    const allTransactions = markTransferLegs(
      stored.length > 0 ? stored : demoRows(held.demoTags),
      { institutions: held.ledger.institutions ?? {} },
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
      hasUploads: held.ledger.imports.length > 0,
      usingDemo: stored.length === 0,
      ready: held.ready,
      importDocuments,
      removeStatement,
      clearInterpretation: clearLedger,
      setTransactionTags,
      setMerchantTags,
      renameTagEverywhere,
      removeTagEverywhere,
    };
  }, [held, period]);

  return <MoneyFlowContext.Provider value={value}>{children}</MoneyFlowContext.Provider>;
}

export function useMoneyFlow() {
  const value = useContext(MoneyFlowContext);
  if (!value) throw new Error("useMoneyFlow must be used within MoneyFlowProvider");
  return value;
}

export { demoAccounts, demoBudgets, demoGoals };

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

function hydrate(): Promise<void> {
  if (loading) return loading;
  store = store ?? createLedgerStore();
  loading = store
    .load()
    .then((stored) => {
      // A statement imported while the read was in flight must not be thrown away.
      update({
        ledger: snapshot.ledger.imports.length > 0 ? snapshot.ledger : stored,
        demoTags: readDemoTags(),
        ready: true,
      });
    })
    .catch(() => update({ demoTags: readDemoTags(), ready: true }));
  return loading;
}

function commit(next: Ledger) {
  update({ ledger: next });
  store = store ?? createLedgerStore();
  void store.save(next);
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

function clearLedger() {
  update({ ledger: EMPTY_LEDGER });
  store = store ?? createLedgerStore();
  void store.clear();
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

function setTransactionTags(id: string, tags: string[]) {
  edit((rows) => rows.map((txn) => (txn.id === id ? withTags(txn, tags) : txn)));
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

/** Tag edits land on the ledger once statements are held, and on the samples until then. */
function edit(change: (rows: InterpretedTransaction[]) => InterpretedTransaction[]) {
  const stored = ledgerTransactions(snapshot.ledger);
  if (stored.length > 0) {
    commit(replaceTransactions(snapshot.ledger, change(stored)));
    return;
  }
  const next = change(demoRows(snapshot.demoTags));
  writeDemoTags(Object.fromEntries(next.map((txn) => [txn.id, tagsOf(txn)])));
}

function demoRows(overrides: Record<string, string[]>): InterpretedTransaction[] {
  return demoTransactions.map((txn) => {
    const row = toInterpreted(txn);
    const tags = overrides[txn.id];
    return tags ? { ...row, tags: [...tags] } : row;
  });
}

function readDemoTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DEMO_TAGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, tags]) => Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))
        .map(([id, tags]) => [id, tags as string[]]),
    );
  } catch {
    return {};
  }
}

function writeDemoTags(next: Record<string, string[]>) {
  try {
    localStorage.setItem(DEMO_TAGS_KEY, JSON.stringify(next));
  } catch {
    // Losing a sample tag edit is not worth interrupting the page for.
  }
  update({ demoTags: next });
}

function toInterpreted(txn: (typeof demoTransactions)[number]): InterpretedTransaction {
  return {
    id: txn.id,
    merchant: txn.merchant,
    category: txn.category,
    tags: [...txn.tags],
    date: txn.date,
    dateIso: parseDate(`${txn.date} 2026`) ?? "2026-08-01",
    amount: txn.amount,
    type: txn.amount > 0 ? "income" : txn.category === "Goals" ? "transfer" : "expense",
    sourceFile: "demo",
    institution: demoAccounts[0].institution,
    confidence: 1,
  };
}
