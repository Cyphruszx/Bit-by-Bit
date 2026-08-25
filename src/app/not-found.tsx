import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { siteName } from "@/lib/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f8f7] px-6 text-center text-[#17211e]">
      <BrandMark />
      <h1 className="mt-10 text-3xl font-bold">This page is not here yet</h1>
      <p className="mt-3 max-w-md text-[#60716a]">
        {siteName} only has the demo surfaces so far. Head back to the dashboard to keep exploring.
      </p>
      <Link href="/dashboard" className="mt-8 rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
        Go to dashboard
      </Link>
    </main>
  );
}
