"use client";

import { useSyncExternalStore } from "react";
import { EVERYTHING, parseScope, type LedgerScope } from "@/lib/money-flow/scope";

/**
 * What the reader is looking at, held in one place so the dashboard and the transactions
 * list always agree, and which banks they have folded away.
 */
const SCOPE_KEY = "bitbybit.scope-v1";

type Stored = { scope: LedgerScope; hidden: string[] };

const DEFAULT_STATE: Stored = { scope: EVERYTHING, hidden: [] };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: Stored = DEFAULT_STATE;

/** Narrowed to what is still held, so removing a statement cannot strand the view. */
export function useScope(known: { institutions: string[]; accounts: string[] }): LedgerScope {
  return parseScope(useSyncExternalStore(subscribe, read, () => DEFAULT_STATE).scope, known);
}

export function setScope(scope: LedgerScope) {
  write({ ...cached, scope });
}

/** Folding a bank away hides its section. Its money is still counted in the totals. */
export function useHiddenInstitutions(): string[] {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_STATE).hidden;
}

export function toggleInstitution(institution: string) {
  const hidden = cached.hidden.includes(institution)
    ? cached.hidden.filter((name) => name !== institution)
    : [...cached.hidden, institution];
  write({ ...cached, hidden });
}

export function showEveryInstitution() {
  write({ ...cached, hidden: [] });
}

function write(next: Stored) {
  cached = next;
  cachedRaw = JSON.stringify(next);
  try {
    localStorage.setItem(SCOPE_KEY, cachedRaw);
  } catch {
    // A browser refusing storage should still let the reader change what they are looking at.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (!raw) {
      cached = DEFAULT_STATE;
      return cached;
    }
    const parsed = JSON.parse(raw) as { scope?: unknown; hidden?: unknown };
    cached = {
      // Left as read; useScope narrows it to what is actually held.
      scope: (parsed.scope as LedgerScope) ?? EVERYTHING,
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((name) => typeof name === "string") : [],
    };
    return cached;
  } catch {
    cached = DEFAULT_STATE;
    return cached;
  }
}
