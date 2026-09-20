"use client";

import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { PeriodChip } from "@/components/period-chip";
import { SummaryCard } from "@/components/summary-card";
import { useTheme } from "@/components/theme-store";
import { formatAud, formatSignedAud } from "@/lib/format";
import { TokenSwatch } from "./token-swatch";
import { colourTokens, darkColourTokens, radiusSamples, spaceSamples } from "./tokens";

const primaryButton =
  "rounded-full bg-primary-strong px-4 py-2 text-[13px] font-bold text-on-primary disabled:opacity-35";
const brandButton = "rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-on-primary disabled:opacity-35";
const secondaryButton =
  "rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-bold text-ink disabled:opacity-35";

const navIdle = "rounded-full px-[13px] py-1.5 text-[13.5px] font-semibold text-muted hover:bg-accent-surface";
const navActive = "rounded-full bg-primary px-[13px] py-1.5 text-[13.5px] font-semibold text-on-primary";

export function DesignSystemGallery() {
  const { theme } = useTheme();
  const [period, setPeriod] = useState<"month" | "year" | "custom" | "all">("month");
  const [nav, setNav] = useState("Dashboard");

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-8 px-0.5 pb-1.5">
        <div className="grid gap-2.5">
          <h1 className="text-[38px] font-bold leading-none tracking-tight">Design system</h1>
          <p className="max-w-[62ch] text-sm leading-6 text-ink-soft">
            Living tokens from <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">src/app/globals.css</code>.
            Swatches use the same Tailwind theme classes as the product —{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">bg-primary</code>,{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">text-ink</code> — not a parallel palette.
          </p>
        </div>
        <div className="grid justify-items-end gap-1.5 text-right text-xs text-muted">
          <span className="rounded-full bg-accent-surface px-3 py-1 font-semibold text-primary-strong">
            {theme === "dark" ? "8a dark" : "7b light"} · Public Sans
          </span>
          <span>Toggle Dark in the header to rematch every swatch.</span>
        </div>
      </header>

      <Section
        index="01"
        eyebrow="Colour tokens"
        title="One blue family, one neutral ramp"
        hint="Blue carries meaning — brand, positive movement, selection. Neutrals carry everything else."
      >
        <div className="grid gap-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Light theme</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {colourTokens.map((token) => (
              <TokenSwatch key={`light-${token.name}`} token={token} />
            ))}
          </div>
        </div>

        <div className="dark grid gap-2.5 rounded-[14px] border border-[rgba(111,155,255,0.14)] bg-canvas p-[18px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Dark theme</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {darkColourTokens.map((token) => (
              <TokenSwatch key={`dark-${token.name}`} token={token} />
            ))}
          </div>
        </div>

        <Guidance
          doText="Use brand blue for money-in figures, the active nav pill, and chart lines. Use the 300/400 steps only inside charts and progress fills."
          dontText="No red or green for amounts — direction is carried by the − / + sign and weight. No pure black; ink is #101214. No new hues."
        />
        <p className="text-[12.5px] leading-relaxed text-muted">
          Attention and negative-strong live in{" "}
          <code className="font-mono text-[11px]">globals.css</code> as named exceptions. They are not part of this
          ramp.
        </p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <Section index="02" eyebrow="Typography" title="Public Sans, four weights">
          <div>
            <TypeRow spec="38 / 700 / −.03em" sampleClass="text-[38px] font-bold leading-none tracking-tight">
              Page title
            </TypeRow>
            <TypeRow spec="27 / 700 / tabular" sampleClass="text-[27px] font-bold tracking-tight tabular-nums">
              {formatAud(18420.65)}
            </TypeRow>
            <TypeRow spec="19 / 700" sampleClass="text-[19px] font-bold tracking-tight">
              Product wordmark
            </TypeRow>
            <TypeRow spec="15.5 / 700" sampleClass="text-[15.5px] font-bold">
              Card heading
            </TypeRow>
            <TypeRow spec="14 / 600" sampleClass="text-sm font-semibold">
              Row title — Coles Brunswick
            </TypeRow>
            <TypeRow spec="13.5 / 600" sampleClass="text-[13.5px] font-semibold">
              Nav item
            </TypeRow>
            <TypeRow spec="13 / 400" sampleClass="text-[13px]">
              Card label — Total balance
            </TypeRow>
            <TypeRow spec="12.5 / 400 muted" sampleClass="text-[12.5px] text-muted">
              Supporting line — across 3 accounts
            </TypeRow>
            <TypeRow spec="11.5 / 600" sampleClass="text-[11.5px] font-semibold">
              Pill label
            </TypeRow>
            <TypeRow spec="10.5 / 700 / .16em" sampleClass="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted">
              Section eyebrow
            </TypeRow>
          </div>
          <p className="text-[12.5px] leading-6 text-muted">
            Every amount gets{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">
              font-variant-numeric: tabular-nums
            </code>{" "}
            so columns align. Negative amounts use the true minus sign (−), not a hyphen. Body copy never drops below
            12.5px.
          </p>
        </Section>

        <div className="grid gap-5">
          <Section index="03" eyebrow="Spacing & radius" title="4px base, generous cards">
            <div className="grid gap-2">
              {spaceSamples.map((sample) => (
                <div key={sample.px} className="flex items-center gap-3">
                  <span className="w-[52px] shrink-0 font-mono text-[11px] text-muted">{sample.px}</span>
                  <span className={`h-2.5 rounded-sm ${sample.barClass}`} />
                  <span className="text-xs text-muted">{sample.use}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3 pt-1">
              {radiusSamples.map((sample) => (
                <div key={sample.cssVar} className="grid justify-items-center gap-1">
                  <div
                    className={`h-10 w-[52px] border border-primary/20 bg-accent-surface ${sample.className}`}
                  />
                  <span className="font-mono text-[11px] text-muted">{sample.value}</span>
                  <span className="text-xs font-semibold text-ink">{sample.name}</span>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] leading-6 text-muted">
              16 for cards, 999 for controls and tags, 2 for the logo mark squares. Don’t invent extra corner radii — if
              it isn’t mark, card, or pill, use one of those.
            </p>
          </Section>
        </div>
      </div>

      <Section
        index="04"
        eyebrow="Components"
        title="The real chrome"
        hint="These are the product components, not restyled stand-ins."
      >
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Pill buttons</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={primaryButton}>
                Add
              </button>
              <button type="button" className={brandButton}>
                Guest mode
              </button>
              <button type="button" className={secondaryButton}>
                Export
              </button>
              <button type="button" className={primaryButton} disabled>
                Add
              </button>
              <button type="button" className={brandButton} disabled>
                Guest mode
              </button>
              <button type="button" className={secondaryButton} disabled>
                Export
              </button>
            </div>
            <p className="text-[12.5px] text-muted">
              Primary is <code className="font-mono text-[11px]">bg-primary-strong</code> (Add). Brand is{" "}
              <code className="font-mono text-[11px]">bg-primary</code>. Secondary is a lined surface pill. Hover is the
              shared 160ms opacity. Disabled keeps the label and mutes the fill.
            </p>
          </div>

          <div className="grid gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Nav pills</p>
            <nav className="flex flex-wrap items-center gap-1">
              {["Dashboard", "Transactions", "Recurring"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className={nav === label ? navActive : navIdle}
                  onClick={() => setNav(label)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="grid gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Period filter chips</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted">Period</p>
              <PeriodChip active={period === "month"} onClick={() => setPeriod("month")}>
                September 2026
              </PeriodChip>
              <PeriodChip active={period === "year"} onClick={() => setPeriod("year")}>
                Last 12 months
              </PeriodChip>
              <PeriodChip active={period === "custom"} onClick={() => setPeriod("custom")}>
                Custom dates
              </PeriodChip>
              <PeriodChip active={period === "all"} onClick={() => setPeriod("all")}>
                All activity
              </PeriodChip>
              <PeriodChip active={false} disabled onClick={() => undefined} ariaLabel="Previous month with activity">
                ‹
              </PeriodChip>
            </div>
          </div>

          <div className="grid gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Cards and SummaryCard</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Money in"
                value={formatSignedAud(6240)}
                detail="Blue for money in"
                positive
              />
              <SummaryCard label="Money out" value={`\u2212${formatAud(4118.4)}`} detail="Direction from the minus" />
              <SummaryCard
                label="Safe to spend"
                value={formatAud(1842.4)}
                detail="Leftover label — not Available or Spendable"
                highlight
              />
              <article className="card p-5">
                <p className="text-sm text-muted">Standard card</p>
                <p className="mt-2 text-[15.5px] font-bold">Recurring bills</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  First-run list noun. Regulars stays in the glossary only.
                </p>
                <ul className="mt-4 divide-y divide-line-dashed text-sm">
                  <li className="flex justify-between py-2 font-semibold">
                    <span>Netflix</span>
                    <span className="tabular-nums">{`\u2212${formatAud(22.99)}`}</span>
                  </li>
                  <li className="flex justify-between py-2 font-semibold">
                    <span>Rent</span>
                    <span className="tabular-nums">{`\u2212${formatAud(1420)}`}</span>
                  </li>
                </ul>
              </article>
            </div>
          </div>

          <div className="grid gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Logo mark</p>
            <div className="flex flex-wrap items-center gap-6">
              <BrandMark />
              <span aria-hidden className="grid grid-cols-2 gap-0.5">
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-mark-1" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-mark-2" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-mark-3" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-mark-4" />
              </span>
              <p className="text-[12.5px] text-muted">Four squares, mark tokens, radius 2px, 2px gap.</p>
            </div>
          </div>
        </div>
      </Section>

      <Section index="05" eyebrow="Language and colour" title="Do and don’t">
        <Guidance
          doText="One primary per view — the deep blue Add. Blue for money-in, selection, and the highlight leftover card labelled Safe to spend."
          dontText="Don’t invent Available, Spendable, or Regulars in chrome. Don’t put two filled buttons side by side. Don’t colour amounts red or green."
        />
      </Section>
    </div>
  );
}

function Section({
  index,
  eyebrow,
  title,
  hint,
  children,
}: {
  index: string;
  eyebrow: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card grid gap-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted">
            {index} · {eyebrow}
          </p>
          <h2 className="mt-1.5 text-[19px] font-bold tracking-tight">{title}</h2>
        </div>
        {hint ? <p className="max-w-sm text-right text-[12.5px] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function TypeRow({
  spec,
  sampleClass,
  children,
}: {
  spec: string;
  sampleClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-[18px] border-b border-line-dashed py-3 last:border-b-0">
      <span className="w-[112px] shrink-0 font-mono text-[11px] text-muted">{spec}</span>
      <span className={sampleClass}>{children}</span>
    </div>
  );
}

function Guidance({ doText, dontText }: { doText: string; dontText: string }) {
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <div className="grid gap-1.5 rounded-[10px] border border-primary/20 bg-accent-surface p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-primary-strong">Do</p>
        <p className="text-[12.5px] leading-relaxed text-ink-soft">{doText}</p>
      </div>
      <div className="grid gap-1.5 rounded-[10px] border border-line bg-surface-subtle p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Don’t</p>
        <p className="text-[12.5px] leading-relaxed text-ink-soft">{dontText}</p>
      </div>
    </div>
  );
}
