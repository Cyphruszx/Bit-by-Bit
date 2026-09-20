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
      className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-35 ${
        active ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}
