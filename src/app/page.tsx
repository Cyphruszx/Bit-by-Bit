import Link from "next/link";
import { AppFrame } from "@/components/app-frame";
import { BrandMark } from "@/components/brand-mark";
import { BudgetRing } from "@/components/budget-ring";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatAud, formatSignedAud } from "@/lib/format";
import { smoothPath } from "@/lib/money-flow/chart-pixels";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary-strong";

const primaryButton = `inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 font-sans text-base font-semibold text-on-primary sm:px-5 ${focusRing}`;
const secondaryButton = `inline-flex min-h-11 items-center justify-center rounded-full border-2 border-line bg-surface px-4 font-sans text-base font-semibold text-ink sm:px-5 ${focusRing}`;
const bandFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-on-primary";
const bandSolid = `inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-surface bg-surface px-5 font-sans text-base font-semibold text-ink sm:w-auto ${bandFocus}`;
const bandGhost = `inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-on-primary bg-transparent px-5 font-sans text-base font-semibold text-on-primary sm:w-auto ${bandFocus}`;

const HERO_CATEGORIES = [
  { label: "Housing", spent: 2085 },
  { label: "Lifestyle", spent: 147 },
  { label: "Shopping", spent: 83 },
  { label: "Transport", spent: 315 },
] as const;

/** Totals from public/samples/up-spending-2026-09.csv. No Tag or Type cells. */
const LEDGER_ROWS = [
  { date: "2026-09-20", merchant: "Woolworths", category: "Groceries", amount: -14 },
  { date: "2026-09-19", merchant: "Ampol", category: "Fuel", amount: -92 },
  { date: "2026-09-18", merchant: "Grill'd", category: "Restaurants & Cafes", amount: -23 },
] as const;

const SAMPLE_CHART = [28, 46, 38, 62, 54, 74, 66, 84];

export default function Home() {
  return (
    <AppFrame>
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-5 md:px-7">
        <BrandMark />
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="[&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-offset-2 [&>button]:focus-visible:outline-solid [&>button]:focus-visible:outline-primary-strong">
            <ThemeToggle />
          </div>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link href="/sign-in" className={secondaryButton}>
              Sign in
            </Link>
            <Link href="/dashboard" className={primaryButton}>
              Demo mode
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1240px] items-center gap-10 px-5 pt-8 pb-16 md:px-7 lg:grid-cols-[minmax(0,1fr)_500px] lg:gap-16 lg:pt-16 lg:pb-24">
          <div>
            <p className="text-sm font-semibold text-primary">Budget planner · Dashboard · Bank CSVs</p>
            <h1 className="mt-4 text-[44px] leading-[1.05] sm:text-[72px] sm:leading-[0.98]">
              Know what&apos;s left to spend.
            </h1>
            <p className="mt-6 max-w-xl text-[19px] leading-8 text-muted">
              Plan an amount for each group, then BitbyBit tracks spent against planned from your Australian bank
              statements, month by month.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/sign-in" className={primaryButton}>
                Sign in
              </Link>
              <Link href="/dashboard" className={secondaryButton}>
                Try Demo mode
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">Or try it with a bank CSV</p>
          </div>

          <article className="card w-full p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15.5px]">Budget · October 2026</p>
              <p className="shrink-0 rounded-[var(--radius-card)] bg-accent-surface px-2.5 py-1 text-xs font-semibold text-primary-strong">
                Sample data
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="grid min-w-0 flex-1 gap-3 rounded-[var(--radius-inner)] border-2 border-line bg-surface-subtle p-3">
                {HERO_CATEGORIES.map((category) => (
                  <div key={category.label} className="min-w-0">
                    <p className="text-sm font-semibold">{category.label}</p>
                    <p className="text-[12.5px] text-muted">{formatAud(category.spent)} spent</p>
                  </div>
                ))}
              </div>
              <BudgetRing planned={4770} spent={4409} />
            </div>
          </article>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 pb-20 md:px-7" aria-labelledby="what-bitbybit-does">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="what-bitbybit-does" className="text-[32px] leading-tight sm:text-[40px]">
              What BitbyBit does
            </h2>
            <p className="max-w-md text-sm leading-6 text-muted sm:text-right">
              Budget groups and categories, Left to plan and Left to spend, with Unsorted shown on its own.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <article className="card flex min-w-0 flex-col justify-between gap-6 p-6 sm:col-span-2 lg:col-span-2">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">CSV</p>
                <h3 className="mt-2 text-2xl">Upload a CSV</h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted">Drop in a bank CSV and see it sorted.</p>
              </div>
              <div>
                <Link href="/dashboard" className={primaryButton}>
                  Try Demo mode
                </Link>
              </div>
            </article>

            <article className="card min-w-0 p-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Summary</p>
              <h3 className="mt-2 text-2xl">Money in and out</h3>
              <p className="mt-2 text-sm leading-6 text-muted">The two totals for a sample month.</p>
              <p className="mt-4 text-xs font-semibold text-muted">Sample</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted">Money in</p>
                  <p className="mt-1 font-display text-2xl text-positive tabular-nums">{formatAud(6240)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Money out</p>
                  <p className="mt-1 font-display text-2xl tabular-nums">{`−${formatAud(4318.65)}`}</p>
                </div>
              </div>
              <SampleFlowChart />
            </article>

            <article className="card min-w-0 p-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Group</p>
              <h3 className="mt-2 text-2xl">Budget</h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                One group, with the left to spend figure centred above the ring.
              </p>
              <p className="mt-4 text-xs font-semibold text-muted">Sample</p>
              <div className="mt-3 flex flex-col items-start gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Housing</p>
                  <p className="text-[12.5px] text-muted">{formatAud(2085)} spent</p>
                </div>
                <BudgetRing planned={2100} spent={2085} />
              </div>
            </article>

            <article className="card min-w-0 p-5 sm:col-span-2 lg:col-span-2">
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Movements</p>
              <h3 className="mt-2 text-2xl">Ledger</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Three rows from a sample statement.</p>
              <p className="mt-4 text-xs font-semibold text-muted">Sample</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="bg-surface-subtle text-muted">
                      <th className="border-y border-line px-3 py-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                        Date
                      </th>
                      <th className="border-y border-line px-3 py-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                        Merchant
                      </th>
                      <th className="border-y border-line px-3 py-2 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                        Category
                      </th>
                      <th className="border-y border-line px-3 py-2 text-right text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {LEDGER_ROWS.map((row) => (
                      <tr key={row.date}>
                        <td className="border-b border-line-dashed px-3 py-3 text-muted tabular-nums">
                          {formatDisplayDate(row.date)} 2026
                        </td>
                        <td className="border-b border-line-dashed px-3 py-3 font-semibold">{row.merchant}</td>
                        <td className="border-b border-line-dashed px-3 py-3">{row.category}</td>
                        <td
                          className={`border-b border-line-dashed px-3 py-3 text-right font-semibold tabular-nums ${
                            row.amount > 0 ? "text-positive" : ""
                          }`}
                        >
                          {formatSignedAud(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card flex min-w-0 items-center px-5 py-4 sm:col-span-2 lg:col-span-3">
              <p className="text-sm leading-6 text-muted">Bank connection with Open Banking is coming soon</p>
            </article>
          </div>
        </section>

        <section className="bg-primary text-on-primary" aria-labelledby="closing-heading">
          <div className="mx-auto max-w-[1240px] px-5 py-16 md:px-7 lg:py-20">
            <h2 id="closing-heading" className="max-w-3xl text-[32px] leading-tight sm:text-[40px]">
              Plan the month against what you actually spent.
            </h2>
            <p className="mt-4 max-w-xl text-[19px] leading-8">
              Try the demo with a bank CSV. Sign in when you want to keep it.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/sign-in" className={bandSolid}>
                Sign in
              </Link>
              <Link href="/dashboard" className={bandGhost}>
                Demo mode
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-5 py-8 md:px-7">
          <BrandMark />
          <p className="max-w-xl text-sm leading-6 text-muted">
            Demo mode works with bank CSVs. Sign in to keep your ledger.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-1 text-sm font-semibold">
            <Link href="/sign-in" className={`inline-flex min-h-11 items-center px-1 ${focusRing}`}>
              Sign in
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <Link href="/dashboard" className={`inline-flex min-h-11 items-center px-1 ${focusRing}`}>
              Demo mode
            </Link>
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
            <Link href="/design-system" className={`inline-flex min-h-11 items-center px-1 ${focusRing}`}>
              Design system
            </Link>
          </nav>
        </div>
      </footer>
    </AppFrame>
  );
}

function SampleFlowChart() {
  const width = 280;
  const height = 84;
  const padX = 4;
  const padY = 8;
  const step = (width - padX * 2) / (SAMPLE_CHART.length - 1);
  const points = SAMPLE_CHART.map((value, index) => ({
    x: padX + index * step,
    y: height - padY - (value / 100) * (height - padY * 2),
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-4 h-20 w-full"
      role="img"
      aria-label="Sample chart of money in and out"
    >
      <line
        x1={padX}
        x2={width - padX}
        y1={height - padY}
        y2={height - padY}
        stroke="var(--color-line)"
        strokeWidth="2"
      />
      <path
        d={smoothPath(points)}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
