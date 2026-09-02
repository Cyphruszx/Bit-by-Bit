"use client";

import { useSyncExternalStore } from "react";
import { EVERYTHING, parseScope, parseScopeView, type LedgerScope, type ScopeView } from "@/lib/money-flow/scope";

/**
 * What the reader is looking at, held in one place so the dashboard and the transactions
 * list always agree: choose NAB on one and the other is already showing NAB.
 */
const SCOPE_KEY = "bitbybit.scope-v1";

export type ScopeState = { view: ScopeView; scope: LedgerScope };

const DEFAULT_STATE: ScopeState = { view: "together", scope: EVERYTHING };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ScopeState = DEFAULT_STATE;

export function useScope(known: { institutions: string[]; accounts: string[] }): ScopeState {
  const held = useSyncExternalStore(subscribe, read, () => DEFAULT_STATE);
  // Checked against what is still held, so removing a statement cannot leave the page
  // scoped to an account that no longer exists.
  return { view: held.view, scope: parseScope(held.scope, known) };
}

export function writeScope(next: ScopeState) {
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

function read(): ScopeState {
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    if (!raw) {
      cached = DEFAULT_STATE;
      return cached;
    }
    const parsed = JSON.parse(raw) as { view?: unknown; scope?: unknown };
    cached = {
      view: parseScopeView(parsed.view),
      // Left as read; the hook narrows it to what is actually held.
      scope: (parsed.scope as LedgerScope) ?? EVERYTHING,
    };
    return cached;
  } catch {
    cached = DEFAULT_STATE;
    return cached;
  }
}
