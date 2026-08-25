"use client";

import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { useMoneyFlow } from "@/components/money-flow-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hasUploads } = useMoneyFlow();

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]">
      <header className="border-b border-[#dce4df] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <BrandMark href="/dashboard" />
          <AppNav />
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#edf4dc] px-3 py-1 text-sm font-medium text-[#355a3f]">
              {hasUploads ? "Interpreted from files" : "Demo data"}
            </span>
            <Link href="/upload" className="rounded-full bg-[#d5f06c] px-4 py-2 text-sm font-bold text-[#173b31]">
              Upload
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </main>
  );
}
