"use client";

import Link from "next/link";
import { AccountLink } from "@/components/account-link";
import { AppFrame } from "@/components/app-frame";
import { AppNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { MobileNav } from "@/components/mobile-nav";
import { PeriodFilterBar } from "@/components/period-filter";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hasUploads, openReviewCount, ready } = useMoneyFlow();

  return (
    <AppFrame>
      <header className="app-header relative z-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-7">
          <BrandMark href="/dashboard" />
          <div className="hidden md:block">
            <AppNav />
          </div>
          <div className="flex items-center gap-2.5">
            {openReviewCount > 0 ? (
              <Link
                href="/transactions"
                className="rounded-full bg-accent-surface px-3 py-1 text-[12.5px] font-semibold text-primary-strong"
              >
                {formatCount(openReviewCount)} to review
              </Link>
            ) : (
              <span className="hidden rounded-full bg-accent-surface px-3 py-1 text-[12.5px] font-medium text-ink-soft sm:inline">
                {!ready ? "Opening your ledger" : hasUploads ? "Interpreted from files" : "No statements yet"}
              </span>
            )}
            <ThemeToggle />
            <div className="flex shrink-0 items-center gap-2">
              <AccountLink />
              <Link
                href="/upload"
                className="rounded-full bg-primary-strong px-4 py-2 text-[13px] font-bold text-on-primary"
              >
                Add
              </Link>
            </div>
          </div>
        </div>
      </header>
      <PeriodFilterBar />
      <div className="relative z-10 mx-auto max-w-[1240px] px-5 py-7 pb-24 md:px-7 md:pb-10">
        {ready ? children : <p className="text-muted">Reading the statements you have already added…</p>}
        <p className="mt-16 text-center text-[12.5px] text-muted">
          <Link href="/design-system" className="underline-offset-4 hover:underline">
            Design system
          </Link>
        </p>
      </div>
      <MobileNav />
    </AppFrame>
  );
}
