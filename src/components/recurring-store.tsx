"use client";

import { useSyncExternalStore } from "react";
import { advanceAfterPaid, type Cadence, type RecurringStore, type TrackedRecurring } from "@/lib/money-flow/recurring";
import { replaceRecurring } from "@/lib/persist/cloud";
import { RECURRING_KEY } from "@/lib/persist/keys";
import { enqueueCloudWrite, financeClient, getCloudUserId, persistDestination } from "@/lib/persist/runtime";

export type { RecurringStore, TrackedRecurring };

const listeners = new Set<() => void>();
const empty: RecurringStore = { ignored: [], confirmed: [], custom: [] };
let cachedRaw: string | null = null;
let cached = empty;
let cloudCache = false;

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
    updatePayment,
    markPaid,
    removeCustomPayment,
  };
}

export function applyRemoteRecurring(store: RecurringStore, useCloudCache: boolean) {
  cloudCache = useCloudCache;
  cachedRaw = useCloudCache ? "__cloud__" : JSON.stringify(store);
  cached = store;
  listeners.forEach((listener) => listener());
}

export function resetRecurringCache() {
  cloudCache = false;
  cachedRaw = null;
  cached = empty;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): RecurringStore {
  if (cloudCache) return cached;
  try {
    const raw = localStorage.getItem(RECURRING_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (!raw) {
      cached = empty;
      return empty;
    }
    const parsed = JSON.parse(raw) as Partial<RecurringStore>;
    cached = {
      ignored: parsed.ignored ?? [],
      confirmed: (parsed.confirmed ?? []).map(withNextDate),
      custom: (parsed.custom ?? []).map(withNextDate),
    };
    return cached;
  } catch {
    cached = empty;
    return empty;
  }
}

function persist(next: RecurringStore) {
  cachedRaw = JSON.stringify(next);
  cached = next;
  const destination = persistDestination();
  if (destination === "local") {
    localStorage.setItem(RECURRING_KEY, cachedRaw);
  } else {
    cloudCache = true;
    const userId = getCloudUserId();
    if (userId) enqueueCloudWrite("recurring", () => replaceRecurring(financeClient(), userId, next));
  }
  listeners.forEach((listener) => listener());
}

function withNextDate(item: TrackedRecurring): TrackedRecurring {
  return { ...item, nextDate: item.nextDate ?? "" };
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

function addCustomPayment(name: string, amount: number, cadence: Cadence, nextDate: string) {
  const store = getSnapshot();
  const id = crypto.randomUUID();
  persist({
    ignored: store.ignored,
    confirmed: store.confirmed,
    custom: [
      ...store.custom,
      { id, fingerprint: `custom:${id}`, name, amount, cadence, nextDate, source: "custom" },
    ],
  });
}

function updatePayment(id: string, patch: Partial<Pick<TrackedRecurring, "nextDate" | "name" | "amount" | "cadence">>) {
  const store = getSnapshot();
  persist({
    ignored: store.ignored,
    confirmed: store.confirmed.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    custom: store.custom.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  });
}

function markPaid(id: string, todayIso: string) {
  const store = getSnapshot();
  persist({
    ignored: store.ignored,
    confirmed: store.confirmed.map((item) =>
      item.id === id ? { ...item, nextDate: advanceAfterPaid(item.nextDate, item.cadence, todayIso) } : item,
    ),
    custom: store.custom.map((item) =>
      item.id === id ? { ...item, nextDate: advanceAfterPaid(item.nextDate, item.cadence, todayIso) } : item,
    ),
  });
}

function removeCustomPayment(id: string) {
  const store = getSnapshot();
  persist({ ...store, custom: store.custom.filter((item) => item.id !== id) });
}
