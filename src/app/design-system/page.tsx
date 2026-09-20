import type { Metadata } from "next";
import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { siteName } from "@/lib/brand";
import { DesignSystemGallery } from "./gallery";

export const metadata: Metadata = {
  title: "Design system",
  description: "Living colour tokens, type, and components from the BitbyBit theme.",
};

export default function DesignSystemPage() {
  return (
    <AppFrame>
      <nav className="mx-auto flex max-w-[1240px] items-center justify-between px-7 py-6">
        <BrandMark />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/dashboard" className="text-sm font-semibold text-ink-soft">
            Dashboard
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-[1240px] px-7 pb-20">
        <DesignSystemGallery />
      </main>
      <footer className="border-t border-line px-7 py-8 text-center text-sm text-muted">
        {siteName} · Preview utility · not a Core flow
      </footer>
    </AppFrame>
  );
}
