"use client";

import { useSyncExternalStore } from "react";
import {
  localIsoDate,
  nextIncludedInTotal,
  recordSavingsSnapshot,
  seedSavingsPots,
  type SavingsPot,
  type SavingsSnapshot,
} from "@/lib/money-flow/savings";

const STORAGE_KEY = "bitbybit.savings-v1";
const listeners = new Set<() => void>();
const seeded = seedSavingsPots();
const emptyState: SavingsState = { pots: seeded, snapshots: [] };
let cachedRaw: string | null = null;
let cachedState = emptyState;

type SavingsState = {
  pots: SavingsPot[];
  snapshots: SavingsSnapshot[];
};

export function useSavingsPots() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => emptyState);
  return { pots: state.pots, snapshots: state.snapshots, addPot, updatePot, removePot, toggleIncluded };
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): SavingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    if (!raw) {
      cachedState = emptyState;
      return emptyState;
    }
    const parsed = JSON.parse(raw) as { pots?: SavingsPot[]; snapshots?: SavingsSnapshot[] };
    cachedState = {
      pots: Array.isArray(parsed.pots) ? parsed.pots : seeded,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
    return cachedState;
  } catch {
    cachedState = emptyState;
    return emptyState;
  }
}

function persist(pots: SavingsPot[]) {
  const current = getSnapshot();
  const snapshots = recordSavingsSnapshot(pots, current.snapshots, localIsoDate());
  const next: SavingsState = { pots, snapshots };
  const raw = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedState = next;
  listeners.forEach((listener) => listener());
}

function addPot(pot: Omit<SavingsPot, "id">) {
  persist([...getSnapshot().pots, { ...pot, id: crypto.randomUUID() }]);
}

function updatePot(id: string, patch: Partial<Omit<SavingsPot, "id">>) {
  persist(getSnapshot().pots.map((pot) => (pot.id === id ? { ...pot, ...patch } : pot)));
}

function removePot(id: string) {
  persist(getSnapshot().pots.filter((pot) => pot.id !== id));
}

function toggleIncluded(id: string) {
  persist(
    getSnapshot().pots.map((pot) => (pot.id === id ? { ...pot, includedInTotal: nextIncludedInTotal(pot) } : pot)),
  );
}

