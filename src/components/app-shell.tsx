import { AppNav } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f6f8f7] text-[#17211e]">
      <header className="border-b border-[#dce4df] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <BrandMark href="/dashboard" />
          <AppNav />
          <span className="rounded-full bg-[#edf4dc] px-3 py-1 text-sm font-medium text-[#355a3f]">Demo data</span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </main>
  );
}
