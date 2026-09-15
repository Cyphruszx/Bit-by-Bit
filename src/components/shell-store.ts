"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_SHELL,
  dismissOffer,
  parseShell,
  persistable,
  removeGoal,
  setFeature,
  setLinkedAccounts,
  setTheme,
  upsertGoal,
  type FeatureId,
  type Goal,
  type ShellState,
  type ThemeId,
} from "@/lib/shell/core-shell";

const STORAGE_KEY = "bitbybit.shell-v1";

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ShellState = DEFAULT_SHELL;

export function useShell(): ShellState {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_SHELL);
}

export function enableFeature(feature: FeatureId, on: boolean) {
  write(setFeature(read(), feature, on));
}

export function dismissEnableOffer() {
  write(dismissOffer(read()));
}

export function saveTheme(theme: ThemeId) {
  write(setTheme(read(), theme));
}

export function saveGoal(goal: Goal) {
  write(upsertGoal(read(), goal));
}

export function deleteGoal(id: string) {
  write(removeGoal(read(), id));
}

export function saveLinkedAccounts(ids: string[]) {
  write(setLinkedAccounts(read(), ids));
}

/** Spec 4 writes the migrated shell blob back so the chrome matches the ledger. */
export function replaceShell(state: ShellState) {
  write(state);
}

export function currentShell(): ShellState {
  return read();
}

function write(next: ShellState) {
  cached = persistable(next);
  cachedRaw = JSON.stringify(cached);
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    // A browser refusing storage should still let the reader change the shell.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function read(): ShellState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = raw ? parseShell(JSON.parse(raw)) : { ...DEFAULT_SHELL, widgets: [{ id: "money-tiles" }] };
    return cached;
  } catch {
    cached = { ...DEFAULT_SHELL, widgets: [{ id: "money-tiles" }] };
    return cached;
  }
}
