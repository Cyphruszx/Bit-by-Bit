import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export type PersistStatus = {
  cloudUserId: string | null;
  hydrating: boolean;
  error: string | null;
};

const listeners = new Set<() => void>();
let status: PersistStatus = { cloudUserId: null, hydrating: false, error: null };
let writeChain: Promise<void> = Promise.resolve();

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
  return Boolean(status.cloudUserId);
}

export function getPersistError() {
  return status.error;
}

export function isHydrating() {
  return status.hydrating;
}

export function setHydrating(value: boolean) {
  setStatus({ hydrating: value });
}

export function setCloudUserId(userId: string | null) {
  setStatus({ cloudUserId: userId });
}

export function setPersistError(message: string | null) {
  setStatus({ error: message });
}

export function financeClient(): SupabaseClient {
  return createBrowserSupabaseClient();
}

export function enqueueCloudWrite(task: () => Promise<void>) {
  writeChain = writeChain.then(async () => {
    try {
      await task();
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
