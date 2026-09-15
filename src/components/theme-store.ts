"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "bitbybit.theme";
const listeners = new Set<() => void>();

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    return "light";
  }
  return systemDark() ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) onChange();
    } catch {
      onChange();
    }
  };
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onMedia);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  return {
    theme,
    setTheme,
    toggleTheme() {
      setTheme(theme === "dark" ? "light" : "dark");
    },
  };
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  apply(theme);
  listeners.forEach((listener) => listener());
}
