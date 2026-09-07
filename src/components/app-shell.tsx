"use client";

import Link from "next/link";
import { AccountLink } from "@/components/account-link";
import { AppNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { PeriodFilterBar } from "@/components/period-filter";
import { useMoneyFlow } from "@/components/money-flow-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hasUploads, ready } = useMoneyFlow();

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      {/* Seven nav links sit between the top of the page and the ledger, and a
          keyboard reader would otherwise walk all of them on every page. */}
      <a
        href="#ledger"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-on-accent"
      >
        Skip to the ledger
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <BrandMark href="/dashboard" />
          <AppNav />
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-surface px-3 py-1 text-sm font-medium text-ink-soft">
              {!ready ? "Opening your ledger" : hasUploads ? "Interpreted from files" : "No statements yet"}
            </span>
            <AccountLink />
            <Link href="/upload" className="rounded-full bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-bold text-on-accent">
              Upload
            </Link>
          </div>
        </div>
      </header>
      <PeriodFilterBar />
      <div id="ledger" className="mx-auto max-w-6xl px-6 py-10">
        {/* Held back so a returning statement holder never sees an empty ledger flash before their own. */}
        {ready ? children : <p className="text-muted">Reading the statements you have already added…</p>}
      </div>
    </main>
  );
}
