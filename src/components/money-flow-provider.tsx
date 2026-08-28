"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { accounts as demoAccounts, budgets as demoBudgets, goals as demoGoals, transactions as demoTransactions } from "@/lib/demo-data";
import { parseDate } from "@/lib/money-flow/parse-values";
import { ALL_PERIOD, filterByPeriod, parsePeriod, summarizePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { removeTag, renameTag, withTags } from "@/lib/money-flow/tags";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";
import { replaceMoneyFlow, replacePeriod } from "@/lib/persist/cloud";
import { isDemoMoneySnapshot } from "@/lib/persist/demo-snapshot";
import { INTERPRETED_KEY, PERIOD_KEY } from "@/lib/persist/keys";
import {
  enqueueCloudWrite,
  financeClient,
  getCloudUserId,
  persistDestination,
} from "@/lib/persist/runtime";

const empty = { files: [] as FileInterpretation[], transactions: [] as InterpretedTransaction[] };
const listeners = new Set<() => void>();
const periodListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSnapshot = empty;
let cachedPeriodRaw: string | null = null;
let cachedPeriod: PeriodFilter = ALL_PERIOD;
let cloudCache = false;
let demoOverrides: InterpretedTransaction[] | null = null;

type MoneyFlowState = {
  files: FileInterpretation[];
  allTransactions: InterpretedTransaction[];
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
  period: PeriodFilter;
  setPeriod: (period: PeriodFilter) => void;
  hasUploads: boolean;
  usingDemo: boolean;
  applyInterpretation: (result: InterpretationResult) => void;
  clearInterpretation: () => void;
  setTransactionTags: (id: string, tags: string[]) => void;
  renameTagEverywhere: (from: string, to: string) => void;
  removeTagEverywhere: (name: string) => void;
};

const MoneyFlowContext = createContext<MoneyFlowState | null>(null);

export function MoneyFlowProvider({ children }: { children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => empty);
  const period = useSyncExternalStore(subscribePeriod, getPeriod, () => ALL_PERIOD);

  const value = useMemo<MoneyFlowState>(() => {
    const hasUploads = stored.files.length > 0;
    const hasStoredTxns = stored.transactions.length > 0;
    const allTransactions = hasStoredTxns ? stored.transactions : (demoOverrides ?? demoInterpreted);
    const transactions = filterByPeriod(allTransactions, period);
    return {
      files: stored.files,
      allTransactions,
      transactions,
      flow: summarizePeriod(allTransactions, period),
      period,
      setPeriod: writePeriod,
      hasUploads,
      usingDemo: !hasStoredTxns,
      applyInterpretation: writeStore,
      clearInterpretation: clearStore,
      setTransactionTags,
      renameTagEverywhere,
      removeTagEverywhere,
    };
  }, [stored, period]);

  return <MoneyFlowContext.Provider value={value}>{children}</MoneyFlowContext.Provider>;
}

export function useMoneyFlow() {
  const value = useContext(MoneyFlowContext);
  if (!value) throw new Error("useMoneyFlow must be used within MoneyFlowProvider");
  return value;
}

export { demoAccounts, demoBudgets, demoGoals };

export function applyRemoteMoneyFlow(
  files: FileInterpretation[],
  transactions: InterpretedTransaction[],
  period: PeriodFilter,
  useCloudCache: boolean,
) {
  cloudCache = useCloudCache;
  demoOverrides = null;
  cachedRaw = useCloudCache ? "__cloud__" : JSON.stringify({ files, transactions });
  cachedSnapshot = { files, transactions };
  cachedPeriodRaw = useCloudCache ? "__cloud__" : JSON.stringify(period);
  cachedPeriod = period;
  listeners.forEach((listener) => listener());
  periodListeners.forEach((listener) => listener());
}

export function resetMoneyFlowCache() {
  cloudCache = false;
  demoOverrides = null;
  cachedRaw = null;
  cachedSnapshot = empty;
  cachedPeriodRaw = null;
  cachedPeriod = ALL_PERIOD;
  listeners.forEach((listener) => listener());
  periodListeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribePeriod(onChange: () => void) {
  periodListeners.add(onChange);
  return () => periodListeners.delete(onChange);
}

function getSnapshot() {
  if (cloudCache) return cachedSnapshot;
  try {
    const raw = localStorage.getItem(INTERPRETED_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    if (!raw) {
      cachedSnapshot = empty;
      return empty;
    }
    const parsed = JSON.parse(raw) as { files?: FileInterpretation[]; transactions?: InterpretedTransaction[] };
    cachedSnapshot = { files: parsed.files ?? [], transactions: parsed.transactions ?? [] };
    return cachedSnapshot;
  } catch {
    cachedSnapshot = empty;
    return empty;
  }
}

function getPeriod(): PeriodFilter {
  if (cloudCache) return cachedPeriod;
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
  cachedPeriodRaw = raw;
  cachedPeriod = period;
  const destination = persistDestination();
  if (destination === "cloud") {
    cloudCache = true;
    const userId = getCloudUserId();
    if (userId) enqueueCloudWrite("period", () => replacePeriod(financeClient(), userId, period));
  } else if (destination === "memory") {
    cloudCache = true;
  } else {
    localStorage.setItem(PERIOD_KEY, raw);
  }
  periodListeners.forEach((listener) => listener());
}

function writeStore(result: InterpretationResult) {
  persist(result.files, result.transactions);
}

function persist(files: FileInterpretation[], transactions: InterpretedTransaction[]) {
  const destination = persistDestination();
  if (destination !== "local" && isDemoMoneySnapshot(files, transactions)) {
    demoOverrides = transactions;
    cachedSnapshot = { files: cachedSnapshot.files, transactions: cachedSnapshot.transactions };
    listeners.forEach((listener) => listener());
    return;
  }

  demoOverrides = null;
  const raw = JSON.stringify({ files, transactions });
  cachedRaw = raw;
  cachedSnapshot = { files, transactions };
  if (destination === "cloud") {
    cloudCache = true;
    const userId = getCloudUserId();
    if (userId) enqueueCloudWrite("money", () => replaceMoneyFlow(financeClient(), userId, files, transactions));
  } else if (destination === "memory") {
    cloudCache = true;
  } else {
    localStorage.setItem(INTERPRETED_KEY, raw);
  }
  listeners.forEach((listener) => listener());
}

function clearStore() {
  demoOverrides = null;
  cachedRaw = null;
  cachedSnapshot = empty;
  const destination = persistDestination();
  if (destination === "cloud") {
    cloudCache = true;
    const userId = getCloudUserId();
    if (userId) enqueueCloudWrite("money", () => replaceMoneyFlow(financeClient(), userId, [], []));
  } else if (destination === "memory") {
    cloudCache = true;
  } else {
    localStorage.removeItem(INTERPRETED_KEY);
  }
  listeners.forEach((listener) => listener());
}

function workingCopy() {
  const stored = getSnapshot();
  if (stored.transactions.length > 0) return stored;
  return { files: stored.files, transactions: demoOverrides ?? demoInterpreted };
}

function setTransactionTags(id: string, tags: string[]) {
  const base = workingCopy();
  persist(
    base.files,
    base.transactions.map((txn) => (txn.id === id ? withTags(txn, tags) : txn)),
  );
}

function renameTagEverywhere(from: string, to: string) {
  const base = workingCopy();
  persist(base.files, renameTag(base.transactions, from, to));
}

function removeTagEverywhere(name: string) {
  const base = workingCopy();
  persist(base.files, removeTag(base.transactions, name));
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
    confidence: 1,
  };
}

const demoInterpreted = demoTransactions.map(toInterpreted);
