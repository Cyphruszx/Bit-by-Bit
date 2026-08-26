"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { accounts as demoAccounts, budgets as demoBudgets, goals as demoGoals, transactions as demoTransactions } from "@/lib/demo-data";
import { parseDate } from "@/lib/money-flow/parse-values";
import { ALL_PERIOD, filterByPeriod, parsePeriod, summarizePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { removeTag, renameTag, withTags } from "@/lib/money-flow/tags";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

const STORAGE_KEY = "bitbybit.interpreted-v1";
const PERIOD_KEY = "bitbybit.period-v1";
const empty = { files: [] as FileInterpretation[], transactions: [] as InterpretedTransaction[] };
const listeners = new Set<() => void>();
const periodListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSnapshot = empty;
let cachedPeriodRaw: string | null = null;
let cachedPeriod: PeriodFilter = ALL_PERIOD;

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
    const allTransactions = hasStoredTxns ? stored.transactions : demoTransactions.map(toInterpreted);
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

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribePeriod(onChange: () => void) {
  periodListeners.add(onChange);
  return () => periodListeners.delete(onChange);
}

function getSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function writeStore(result: InterpretationResult) {
  persist(result.files, result.transactions);
}

function persist(files: FileInterpretation[], transactions: InterpretedTransaction[]) {
  const raw = JSON.stringify({ files, transactions });
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedSnapshot = { files, transactions };
  listeners.forEach((listener) => listener());
}

function clearStore() {
  localStorage.removeItem(STORAGE_KEY);
  cachedRaw = null;
  cachedSnapshot = empty;
  listeners.forEach((listener) => listener());
}

function workingCopy() {
  const stored = getSnapshot();
  if (stored.transactions.length > 0) return stored;
  return { files: stored.files, transactions: demoTransactions.map(toInterpreted) };
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
