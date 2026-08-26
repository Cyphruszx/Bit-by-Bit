"use client";

import { useSyncExternalStore } from "react";
import { seedSavingsPots, type SavingsPot } from "@/lib/money-flow/savings";

const STORAGE_KEY = "bitbybit.savings-v1";
const listeners = new Set<() => void>();
const seeded = seedSavingsPots();
let cachedRaw: string | null = null;
let cachedPots = seeded;

export function useSavingsPots() {
  const pots = useSyncExternalStore(subscribe, getSnapshot, () => seeded);
  return { pots, addPot, updatePot, removePot };
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): SavingsPot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedPots;
    cachedRaw = raw;
    if (!raw) {
      cachedPots = seeded;
      return seeded;
    }
    const parsed = JSON.parse(raw) as { pots?: SavingsPot[] };
    cachedPots = Array.isArray(parsed.pots) ? parsed.pots : seeded;
    return cachedPots;
  } catch {
    cachedPots = seeded;
    return seeded;
  }
}

function persist(pots: SavingsPot[]) {
  const raw = JSON.stringify({ pots });
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedPots = pots;
  listeners.forEach((listener) => listener());
}

function addPot(pot: Omit<SavingsPot, "id">) {
  persist([...getSnapshot(), { ...pot, id: crypto.randomUUID() }]);
}

function updatePot(id: string, patch: Partial<Omit<SavingsPot, "id">>) {
  persist(getSnapshot().map((pot) => (pot.id === id ? { ...pot, ...patch } : pot)));
}

function removePot(id: string) {
  persist(getSnapshot().filter((pot) => pot.id !== id));
}
