"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { accounts as demoAccounts, budgets as demoBudgets, goals as demoGoals, periodLabel as demoPeriod, snapshot as demoSnapshot, transactions as demoTransactions } from "@/lib/demo-data";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

const STORAGE_KEY = "bitbybit.interpreted-v1";
const empty = { files: [] as FileInterpretation[], transactions: [] as InterpretedTransaction[] };
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSnapshot = empty;

type MoneyFlowState = {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
  hasUploads: boolean;
  usingDemo: boolean;
  applyInterpretation: (result: InterpretationResult) => void;
  clearInterpretation: () => void;
};

const MoneyFlowContext = createContext<MoneyFlowState | null>(null);

export function MoneyFlowProvider({ children }: { children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => empty);

  const value = useMemo<MoneyFlowState>(() => {
    const hasUploads = stored.transactions.length > 0;
    return {
      files: stored.files,
      transactions: hasUploads ? stored.transactions : demoTransactions.map(toInterpreted),
      flow: hasUploads ? summarizeMoneyFlow(stored.transactions) : demoFlow(),
      hasUploads,
      usingDemo: !hasUploads,
      applyInterpretation: writeStore,
      clearInterpretation: clearStore,
    };
  }, [stored]);

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

function writeStore(result: InterpretationResult) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ files: result.files, transactions: result.transactions }));
  cachedRaw = null;
  listeners.forEach((listener) => listener());
}

function clearStore() {
  localStorage.removeItem(STORAGE_KEY);
  cachedRaw = null;
  listeners.forEach((listener) => listener());
}

function toInterpreted(txn: (typeof demoTransactions)[number]): InterpretedTransaction {
  return {
    id: txn.id,
    merchant: txn.merchant,
    category: txn.category,
    date: txn.date,
    dateIso: "2026-08-01",
    amount: txn.amount,
    type: txn.amount > 0 ? "income" : txn.category === "Goals" ? "transfer" : "expense",
    sourceFile: "demo",
    confidence: 1,
  };
}

function demoFlow(): MoneyFlowSummary {
  return {
    income: demoSnapshot.income,
    spending: demoSnapshot.spending,
    net: demoSnapshot.net,
    transfers: 400,
    refunds: 0,
    transactionCount: demoTransactions.length,
    categories: demoBudgets.map((budget) => ({
      name: budget.name,
      amount: budget.spent,
      share: Math.round((budget.spent / demoSnapshot.spending) * 100),
    })),
    periodLabel: demoPeriod,
    insights: [
      "This is sample activity so you can look around.",
      "Upload a statement to replace it with money flow from your documents.",
    ],
  };
}
