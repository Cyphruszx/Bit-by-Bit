"use client";

import { useTheme } from "@/components/theme-store";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} mode`}
      title={theme === "dark" ? "7b light sweep" : "8a dark sweep"}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
