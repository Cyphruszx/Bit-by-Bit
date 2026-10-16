"use client";

import { useSyncExternalStore } from "react";

/** The face for the whole app. Public Sans unless this device picked Geist Pixel. */

export const FONT_STORAGE_KEY = "bitbybit.font";

export type AppFont = "public-sans" | "geist-pixel";

const listeners = new Set<() => void>();

export function readAppFont(): AppFont {
  if (typeof window === "undefined") return "public-sans";
  try {
    return window.localStorage.getItem(FONT_STORAGE_KEY) === "geist-pixel" ? "geist-pixel" : "public-sans";
  } catch {
    return "public-sans";
  }
}

export function applyAppFont(font: AppFont) {
  if (typeof document === "undefined") return;
  if (font === "geist-pixel") document.documentElement.dataset.font = "geist-pixel";
  else delete document.documentElement.dataset.font;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppFont(): AppFont {
  return useSyncExternalStore(subscribe, readAppFont, () => "public-sans");
}

export function writeAppFont(font: AppFont) {
  try {
    if (font === "geist-pixel") window.localStorage.setItem(FONT_STORAGE_KEY, font);
    else window.localStorage.removeItem(FONT_STORAGE_KEY);
  } catch {
    /* private mode */
  }
  applyAppFont(font);
  listeners.forEach((listener) => listener());
}
