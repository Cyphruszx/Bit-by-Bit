"use client";

import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { AuthBar } from "@/components/auth-bar";
import { BrandMark } from "@/components/brand-mark";
import { PeriodFilterBar } from "@/components/period-filter";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { useSession } from "@/components/session-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hasUploads, usingDemo } = useMoneyFlow();
  const { user, persistError, hydrating } = useSession();

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]">
      <header className="border-b border-[#dce4df] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <BrandMark href="/dashboard" />
          <AppNav />
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#edf4dc] px-3 py-1 text-sm font-medium text-[#355a3f]">
              {statusLabel({ hasUploads, usingDemo, signedIn: Boolean(user), hydrating })}
            </span>
            <AuthBar />
            <Link href="/upload" className="rounded-full bg-[#d5f06c] px-4 py-2 text-sm font-bold text-[#173b31]">
              Upload
            </Link>
          </div>
        </div>
      </header>
      {persistError ? (
        <p className="border-b border-[#f0d2cc] bg-[#f8ece9] px-6 py-3 text-center text-sm text-[#9b3b32]">{persistError}</p>
      ) : null}
      <PeriodFilterBar />
      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </main>
  );
}

function statusLabel({
  hasUploads,
  usingDemo,
  signedIn,
  hydrating,
}: {
  hasUploads: boolean;
  usingDemo: boolean;
  signedIn: boolean;
  hydrating: boolean;
}) {
  if (hydrating) return "Loading your account";
  if (signedIn && !usingDemo) return "Saved to your account";
  if (hasUploads) return signedIn ? "Interpreted from files" : "On this device";
  if (usingDemo) return "Demo data";
  return signedIn ? "Saved to your account" : "Edited in this browser";
}
