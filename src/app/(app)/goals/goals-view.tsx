"use client";

import Link from "next/link";
import { GoalsWidget } from "@/components/shell-widgets";
import { useShell } from "@/components/shell-store";

export function GoalsView() {
  const { enabled } = useShell();
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
      <p className="mt-2 text-muted">Manual allocated amount. Not Actual Savings. Does not write the ledger.</p>
      {enabled.goals ? (
        <GoalsWidget />
      ) : (
        <p className="mt-8 text-sm text-muted">
          Goals stay off until you enable them from the dashboard after the first CLEARED row.{" "}
          <Link href="/dashboard" className="font-semibold text-ink-soft underline">
            Customise on Dashboard
          </Link>
        </p>
      )}
    </>
  );
}
