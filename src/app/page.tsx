import Link from "next/link";
import { AccountLink } from "@/components/account-link";
import { AppFrame } from "@/components/app-frame";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { siteDescription, siteName } from "@/lib/brand";
import {
  CSV_WEEKLY_LIMIT,
  ingestQuotasDisabled,
  LAUNCH_BANK_PRESETS,
  OCR_PAGE_WEEKLY_LIMIT,
} from "@/lib/money-flow/core-ingest";
import { canSignIn } from "@/lib/supabase/config";

const features = [
  [
    "CSV, PDF, and photos",
    ingestQuotasDisabled()
      ? "Bank CSV and digital PDF map onto a template, you Confirm the preview, and scanned pages go through OCR. Testing — weekly quotas are off."
      : `Bank CSV and digital PDF map onto a template, you Confirm the preview, and scanned pages go through OCR. ${CSV_WEEKLY_LIMIT} CSVs and ${OCR_PAGE_WEEKLY_LIMIT} OCR pages each Australian week.`,
  ],
  [
    "Connect a bank",
    "Signed-in Open Banking through Fiskil. Sandbox institutions for now — real banks when Fiskil unlocks the team. CSV, PDF, and photos still work as a guest.",
  ],
  [
    "Dashboard and ledger",
    "Money in, money out, and categories on the dashboard, plus a transactions list you can scan.",
  ],
  [
    "Review Queue",
    "Ambiguous rows wait here. Same-bank transfers are usually quiet; transfers across banks still need a look.",
  ],
  [
    "Soft pools",
    "Name a group of accounts without merging them — one view, still separate accounts.",
  ],
  [
    "Guest or signed in",
    "No account needed. Sign in backs the ledger up to Supabase so it follows you to another device.",
  ],
];

const primaryCtaClass = "rounded-full bg-primary px-6 py-3 font-bold text-on-primary";
const secondaryCtaClass =
  "rounded-full border border-line bg-surface px-6 py-3 font-bold text-ink";

export default function Home() {
  const signInReady = canSignIn();

  return (
    <AppFrame>
      <nav className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-6 md:px-7">
        <BrandMark />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <AccountLink />
          <Link href="/dashboard" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary">
            Guest mode
          </Link>
        </div>
      </nav>
      <section className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-20 pt-16 md:grid-cols-[1.1fr_.9fr] md:items-center md:px-7 md:pt-24">
        <div>
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.2em] text-muted">Australian money flow</p>
          <h1 className="max-w-xl text-5xl font-bold tracking-tight md:text-6xl">Upload a statement. See the money flow.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-muted">{siteDescription}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {signInReady ? (
              <Link href="/sign-in" className={primaryCtaClass}>
                Sign in
              </Link>
            ) : null}
            <Link href="/dashboard" className={signInReady ? secondaryCtaClass : primaryCtaClass}>
              Guest mode
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">
            Or{" "}
            <Link href="/upload" className="font-semibold text-ink-soft underline-offset-4 hover:underline">
              upload a statement
            </Link>{" "}
            — it stays in this browser until you sign in.
          </p>
        </div>
        <div className="card-highlight p-7">
          <p className="text-sm text-on-dark-muted">What BitbyBit reads</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-on-dark-muted">
            <li>
              Bank CSV — template mapping, then Confirm
              {ingestQuotasDisabled() ? " (testing — quotas off)" : ` (${CSV_WEEKLY_LIMIT} per AU week)`}
            </li>
            <li>
              Digital PDF — text extract, or OCR when scanned
              {ingestQuotasDisabled() ? " (testing — quotas off)" : ` (${CSV_WEEKLY_LIMIT} CSV slots / ${OCR_PAGE_WEEKLY_LIMIT} OCR pages per AU week)`}
            </li>
            <li>
              Photos of receipts and printed pages
              {ingestQuotasDisabled()
                ? " (testing — quotas off)"
                : ` (${OCR_PAGE_WEEKLY_LIMIT} OCR pages per AU week)`}
            </li>
            <li>Open Banking via Fiskil when you sign in (sandbox institutions for now)</li>
            <li>CSV presets: {LAUNCH_BANK_PRESETS.join(", ")}</li>
          </ul>
          <p className="mt-8 text-sm text-on-dark-muted">Then it shows</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-inner)] bg-on-primary/10 p-4">
              <p className="text-xs text-on-dark-muted">Money in</p>
              <p className="mt-1 font-bold">Income and refunds</p>
            </div>
            <div className="rounded-[var(--radius-inner)] bg-on-primary/10 p-4">
              <p className="text-xs text-on-dark-muted">Money out</p>
              <p className="mt-1 font-bold">Spending by category</p>
            </div>
            <div className="rounded-[var(--radius-inner)] bg-on-primary/10 p-4">
              <p className="text-xs text-on-dark-muted">Ledger</p>
              <p className="mt-1 font-bold">Every movement</p>
            </div>
            <div className="rounded-[var(--radius-inner)] bg-on-primary/10 p-4">
              <p className="text-xs text-on-dark-muted">Review Queue</p>
              <p className="mt-1 font-bold">When it is unclear</p>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-[1240px] gap-4 px-5 pb-16 md:grid-cols-2 md:px-7 lg:grid-cols-3">
        {features.map(([title, description]) => (
          <article key={title} className="card p-6">
            <h2 className="font-bold">{title}</h2>
            <p className="mt-2 leading-6 text-muted">{description}</p>
          </article>
        ))}
      </section>
      <footer className="border-t border-line px-5 py-8 text-center text-sm text-muted md:px-7">
        {siteName} · Works as a guest in this browser. Sign in to back up the ledger and take it with you.
        {" · "}
        <Link href="/design-system" className="underline-offset-4 hover:underline">
          Design system
        </Link>
      </footer>
    </AppFrame>
  );
}
