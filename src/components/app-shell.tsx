"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountLink } from "@/components/account-link";
import { AppFrame } from "@/components/app-frame";
import { SettingsNavItem, SidebarNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { MobileNav } from "@/components/mobile-nav";
import { PeriodFilterBar } from "@/components/period-filter";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { StarterResetPrompt } from "@/components/starter-reset-prompt";
import { formatCount } from "@/lib/format";
import { showDesignSystem } from "@/lib/ui/show-design-system";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showPeriod = pathname !== "/settings";
  const { dismissStarterReset, openReviewCount, ready, resetStarterData, showingSample, starterResetNeeded } = useMoneyFlow();

  return (
    <AppFrame>
      <div className="relative z-10 flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col justify-between border-r-2 border-line bg-surface px-4 py-6 md:flex">
          <div className="flex w-full flex-col gap-7">
            <div className="px-3">
              <BrandMark href="/dashboard" size="sm" />
            </div>
            <SidebarNav />
          </div>
          <div className="flex w-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <ThemeToggle />
              <AccountLink />
              <AddLink />
            </div>
            <div className="border-t-2 border-line pt-3">
              <SettingsNavItem />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="app-header md:hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <BrandMark href="/dashboard" size="sm" />
              <div className="flex items-center gap-2">
                <Link
                  href="/settings"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-semibold text-ink-soft"
                >
                  Settings
                </Link>
                <ThemeToggle />
                <AccountLink />
                <AddLink />
              </div>
            </div>
          </header>
          {ready && starterResetNeeded ? (
            <StarterResetPrompt onReset={resetStarterData} onDismiss={dismissStarterReset} />
          ) : null}
          <div className="relative z-10 mx-auto w-full max-w-[1240px] px-5 pb-24 md:px-7 md:pb-10">
            {showPeriod ? (
              <div className="relative z-20 flex justify-end pt-7">
                <PeriodFilterBar />
              </div>
            ) : null}
            <div className="pt-7">
              {showingSample ? (
                <p className="mb-4 rounded-[var(--radius-card)] bg-accent-surface px-3 py-2 text-sm font-semibold text-primary-strong">
                  Demo mode · Sample
                </p>
              ) : null}
              {openReviewCount > 0 ? (
                <p className="mb-4">
                  <Link
                    href="/review"
                    className="rounded-[var(--radius-card)] bg-accent-surface px-3 py-1.5 text-sm font-semibold text-primary-strong"
                  >
                    {formatCount(openReviewCount)} to review
                  </Link>
                </p>
              ) : null}
              {ready || pathname === "/review" ? (
                children
              ) : (
                <p className="text-muted">Reading the statements you have already added…</p>
              )}
              {showDesignSystem() ? (
                <p className="mt-16 text-center text-[12.5px] text-muted">
                  <Link href="/design-system" className="underline-offset-4 hover:underline">
                    Design system
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <MobileNav />
    </AppFrame>
  );
}

function AddLink() {
  return (
    <Link href="/upload" className="rounded-full bg-primary-strong px-4 py-2 font-display text-base text-on-primary">
      Add
    </Link>
  );
}
