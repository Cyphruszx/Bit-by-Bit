import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export type PersistStatus = {
  cloudUserId: string | null;
  hydrating: boolean;
  ready: boolean;
  error: string | null;
};

export type CloudWriteKey = "money" | "period" | "recurring" | "savings";
export type PersistDestination = "cloud" | "memory" | "local";

const listeners = new Set<() => void>();
let status: PersistStatus = { cloudUserId: null, hydrating: false, ready: false, error: null };
let writeChain: Promise<void> = Promise.resolve();
const pending = new Map<CloudWriteKey, () => Promise<void>>();
const deferred = new Map<CloudWriteKey, () => Promise<void>>();

export function getPersistStatus(): PersistStatus {
  return status;
}

export function subscribePersistStatus(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setStatus(patch: Partial<PersistStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

export function getCloudUserId() {
  return status.cloudUserId;
}

export function isCloudPersistEnabled() {
  return Boolean(status.cloudUserId) && status.ready && !status.hydrating;
}

export function persistDestination(): PersistDestination {
  if (!status.cloudUserId) return "local";
  if (status.ready && !status.hydrating) return "cloud";
  return "memory";
}

export function getPersistError() {
  return status.error;
}

export function isHydrating() {
  return status.hydrating;
}

export function setHydrating(value: boolean) {
  setStatus({ hydrating: value });
  if (!value && status.ready) flushDeferredWrites();
}

export function setCloudUserId(userId: string | null) {
  setStatus({ cloudUserId: userId });
}

export function setPersistReady(value: boolean) {
  setStatus({ ready: value });
  if (value && !status.hydrating) flushDeferredWrites();
}

export function setPersistError(message: string | null) {
  setStatus({ error: message });
}

export function primeCloudHydration(userId: string) {
  if (status.cloudUserId === userId) return;
  status = { cloudUserId: userId, hydrating: true, ready: false, error: null };
}

export function financeClient(): SupabaseClient {
  return createBrowserSupabaseClient();
}

export function hasDeferredWrite(key: CloudWriteKey) {
  return deferred.has(key);
}

export function enqueueCloudWrite(key: CloudWriteKey, task: () => Promise<void>) {
  if (!isCloudPersistEnabled()) {
    deferred.set(key, task);
    return writeChain;
  }
  return queueWrite(key, task);
}

function flushDeferredWrites() {
  if (deferred.size === 0) return;
  const tasks = [...deferred.entries()];
  deferred.clear();
  for (const [key, task] of tasks) queueWrite(key, task);
}

function queueWrite(key: CloudWriteKey, task: () => Promise<void>) {
  pending.set(key, task);
  writeChain = writeChain.then(async () => {
    const next = pending.get(key);
    if (next !== task) return;
    pending.delete(key);
    try {
      await next();
      if (status.error) setPersistError(null);
    } catch (error) {
      setPersistError(error instanceof Error ? error.message : "Could not save to your account.");
    }
  });
  return writeChain;
}

export async function flushCloudWrites() {
  await writeChain;
}

export function clearDeferredWrites() {
  deferred.clear();
}

export function resetPersistRuntime() {
  status = { cloudUserId: null, hydrating: false, ready: false, error: null };
  writeChain = Promise.resolve();
  pending.clear();
  deferred.clear();
}
