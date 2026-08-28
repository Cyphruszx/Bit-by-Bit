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
import { replaceSavings } from "@/lib/persist/cloud";
import { SAVINGS_KEY } from "@/lib/persist/keys";
import { enqueueCloudWrite, financeClient, getCloudUserId, persistDestination } from "@/lib/persist/runtime";

const listeners = new Set<() => void>();
const seeded = seedSavingsPots();
const emptyState: SavingsState = { pots: seeded, snapshots: [] };
let cachedRaw: string | null = null;
let cachedState = emptyState;
let cloudCache = false;
let cloudHasSavings = false;

type SavingsState = {
  pots: SavingsPot[];
  snapshots: SavingsSnapshot[];
};

export function useSavingsPots() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => emptyState);
  return { pots: state.pots, snapshots: state.snapshots, addPot, updatePot, removePot, toggleIncluded };
}

export function applyRemoteSavings(pots: SavingsPot[], snapshots: SavingsSnapshot[], useCloudCache: boolean) {
  cloudCache = useCloudCache;
  cloudHasSavings = pots.length > 0 || snapshots.length > 0;
  cachedState = cloudHasSavings ? { pots, snapshots } : emptyState;
  cachedRaw = useCloudCache ? "__cloud__" : JSON.stringify({ pots, snapshots });
  listeners.forEach((listener) => listener());
}

export function resetSavingsCache() {
  cloudCache = false;
  cloudHasSavings = false;
  cachedRaw = null;
  cachedState = emptyState;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): SavingsState {
  if (cloudCache) return cloudHasSavings ? cachedState : emptyState;
  try {
    const raw = localStorage.getItem(SAVINGS_KEY);
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
  cachedRaw = JSON.stringify(next);
  cachedState = next;
  const destination = persistDestination();
  if (destination === "local") {
    localStorage.setItem(SAVINGS_KEY, cachedRaw);
  } else {
    cloudCache = true;
    cloudHasSavings = true;
    const userId = getCloudUserId();
    if (userId) enqueueCloudWrite("savings", () => replaceSavings(financeClient(), userId, pots, snapshots));
  }
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
