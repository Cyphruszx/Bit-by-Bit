import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { siteName } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center text-ink">
      <BrandMark />
      <h1 className="mt-10 text-3xl font-bold">This page is not here yet</h1>
      <p className="mt-3 max-w-md text-muted">
        There is nothing at this address. Head back to the dashboard to find what {siteName} has read.
      </p>
      <Link href="/dashboard" className="mt-8 rounded-full bg-primary hover:bg-primary-hover px-5 py-2.5 text-sm font-semibold text-on-primary">
        Go to dashboard
      </Link>
    </main>
  );
}
