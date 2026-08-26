"use client";

import { useSyncExternalStore } from "react";
import type { Cadence } from "@/lib/money-flow/recurring";

const STORAGE_KEY = "bitbybit.recurring-v1";
const listeners = new Set<() => void>();
const empty: RecurringStore = { ignored: [], confirmed: [], custom: [] };
let cachedRaw: string | null = null;
let cached = empty;

export type TrackedRecurring = {
  id: string;
  fingerprint: string;
  name: string;
  amount: number;
  cadence: Cadence;
  source: "detected" | "custom";
};

export type RecurringStore = {
  ignored: string[];
  confirmed: TrackedRecurring[];
  custom: TrackedRecurring[];
};

export function useRecurringStore() {
  const store = useSyncExternalStore(subscribe, getSnapshot, () => empty);
  return {
    ignored: new Set(store.ignored),
    confirmed: store.confirmed,
    custom: store.custom,
    confirmPayment,
    ignorePayment,
    stopTracking,
    addCustomPayment,
    removeCustomPayment,
  };
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): RecurringStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (!raw) {
      cached = empty;
      return empty;
    }
    const parsed = JSON.parse(raw) as Partial<RecurringStore>;
    cached = {
      ignored: parsed.ignored ?? [],
      confirmed: parsed.confirmed ?? [],
      custom: parsed.custom ?? [],
    };
    return cached;
  } catch {
    cached = empty;
    return empty;
  }
}

function persist(next: RecurringStore) {
  const raw = JSON.stringify(next);
  localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cached = next;
  listeners.forEach((listener) => listener());
}

function confirmPayment(payment: Omit<TrackedRecurring, "id" | "source">) {
  const store = getSnapshot();
  persist({
    ignored: store.ignored.filter((key) => key !== payment.fingerprint),
    confirmed: [
      ...store.confirmed.filter((item) => item.fingerprint !== payment.fingerprint),
      { ...payment, id: crypto.randomUUID(), source: "detected" },
    ],
    custom: store.custom,
  });
}

function ignorePayment(fingerprint: string) {
  const store = getSnapshot();
  persist({
    ignored: [...new Set([...store.ignored, fingerprint])],
    confirmed: store.confirmed.filter((item) => item.fingerprint !== fingerprint),
    custom: store.custom,
  });
}

function stopTracking(id: string) {
  const store = getSnapshot();
  persist({
    ignored: store.ignored,
    confirmed: store.confirmed.filter((item) => item.id !== id),
    custom: store.custom.filter((item) => item.id !== id),
  });
}

function addCustomPayment(name: string, amount: number, cadence: Cadence) {
  const store = getSnapshot();
  const id = crypto.randomUUID();
  persist({
    ignored: store.ignored,
    confirmed: store.confirmed,
    custom: [
      ...store.custom,
      { id, fingerprint: `custom:${id}`, name, amount, cadence, source: "custom" },
    ],
  });
}

function removeCustomPayment(id: string) {
  const store = getSnapshot();
  persist({ ...store, custom: store.custom.filter((item) => item.id !== id) });
}
