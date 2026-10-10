"use client";

import type { ReactNode } from "react";

export function PeriodChip({
  active,
  onClick,
  children,
  disabled = false,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-3.5 py-2 font-display text-base disabled:opacity-35 ${
        active ? "bg-primary text-on-primary" : "border-2 border-line bg-surface text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}
