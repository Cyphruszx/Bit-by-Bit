"use client";

import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { PeriodChip } from "@/components/period-chip";
import { SummaryCard } from "@/components/summary-card";
import { useTheme } from "@/components/theme-store";
import { formatAud, formatSignedAud } from "@/lib/format";
import { TokenSwatch } from "./token-swatch";
import {
  colourTokens,
  darkColourTokens,
  gridSample,
  radiusSamples,
  shadowSamples,
  spaceSamples,
  typeFaces,
} from "./tokens";

const primaryButton =
  "rounded-full bg-primary-strong px-4 py-2 font-display text-base text-on-primary disabled:opacity-35";
const brandButton =
  "rounded-full bg-primary px-5 py-2.5 font-display text-base text-on-primary disabled:opacity-35";
const secondaryButton =
  "rounded-full border-2 border-line bg-surface px-5 py-2.5 font-display text-base text-ink disabled:opacity-35";

const navIdle = "rounded-full px-3.5 py-1.5 font-display text-base text-muted hover:bg-accent-surface";
const navActive = "rounded-full bg-primary px-3.5 py-1.5 font-display text-base text-on-primary";

export function DesignSystemGallery() {
  const { theme } = useTheme();
  const [period, setPeriod] = useState<"month" | "year" | "custom" | "all">("month");
  const [nav, setNav] = useState("Dashboard");

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-8 px-0.5 pb-1.5">
        <div className="grid gap-2.5">
          <h1 className="font-display text-[32px]">Design system</h1>
          <p className="max-w-[62ch] text-sm leading-6 text-ink-soft">
            Living tokens from <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">src/app/globals.css</code>.
            Swatches use the same Tailwind theme classes as the product —{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">bg-primary</code>,{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">text-ink</code> — not a parallel palette.
          </p>
        </div>
        <div className="grid justify-items-end gap-1.5 text-right text-xs text-muted">
          <span className="rounded-full bg-accent-surface px-3 py-1.5 font-display text-base text-primary-strong">
            {theme === "dark" ? "8a dark" : "7b light"} · Silkscreen + Public Sans
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
          <p className="font-display text-base uppercase text-muted">Light theme</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {colourTokens.map((token) => (
              <TokenSwatch key={`light-${token.name}`} token={token} />
            ))}
          </div>
        </div>

        <div className="dark grid gap-2.5 rounded-[var(--radius-inner)] border-2 border-secondary/20 bg-surface-subtle p-[18px]">
          <p className="font-display text-base uppercase text-muted">Dark theme</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {darkColourTokens.map((token) => (
              <TokenSwatch key={`dark-${token.name}`} token={token} />
            ))}
          </div>
        </div>

        <Guidance
          doText="Use brand blue for money-in figures, the active nav pill, and chart lines. Use the 300/400 steps only inside charts and progress fills."
          dontText="No red or green for amounts — direction is carried by the − / + sign and weight. No pure black; ink (`--color-ink`) is #101214 in light. No new hues."
        />
        <p className="text-[12.5px] leading-relaxed text-muted">
          Attention and negative-strong live in{" "}
          <code className="font-mono text-[11px]">globals.css</code> as named exceptions. They are not part of this
          ramp.
        </p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <Section index="02" eyebrow="Typography" title="Silkscreen for chrome, Public Sans for data">
          <div className="grid gap-2 pb-2">
            {typeFaces.map((face) => (
              <p key={face.cssVar} className="text-[12.5px] leading-6 text-muted">
                <span className="font-semibold text-ink">{face.name}</span>{" "}
                <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">{face.cssVar}</code>
                {" — "}
                {face.use}
              </p>
            ))}
          </div>
          <div>
            <TypeRow spec="32 / 400 display" sampleClass="font-display text-[32px]">
              Page title
            </TypeRow>
            <TypeRow spec="27 / 700 tabular" sampleClass="font-sans text-[27px] font-bold tracking-tight tabular-nums">
              {formatAud(18420.65)}
            </TypeRow>
            <TypeRow spec="24 / 400 display" sampleClass="font-display text-2xl">
              Product wordmark
            </TypeRow>
            <TypeRow spec="15.5 / 700" sampleClass="text-[15.5px] font-bold">
              Card heading
            </TypeRow>
            <TypeRow spec="14 / 600" sampleClass="text-sm font-semibold">
              Row title — Coles Brunswick
            </TypeRow>
            <TypeRow spec="16 / 400 display" sampleClass="font-display text-base">
              Nav item
            </TypeRow>
            <TypeRow spec="13 / 400" sampleClass="text-[13px]">
              Card label — Total balance
            </TypeRow>
            <TypeRow spec="12.5 / 400 muted" sampleClass="text-[12.5px] text-muted">
              Supporting line — across 3 accounts
            </TypeRow>
            <TypeRow spec="16 / 400 display" sampleClass="font-display text-base">
              Button label
            </TypeRow>
            <TypeRow spec="16 / 400 display" sampleClass="font-display text-base uppercase text-muted">
              Section eyebrow
            </TypeRow>
          </div>
          <p className="text-[12.5px] leading-6 text-muted">
            Pixel type is Silkscreen at 8px multiples (16 / 24 / 32 / 48), regular weight, no smoothing — boxier and clearer than Pixelify. Every amount stays on Public Sans with{" "}
            <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">
              font-variant-numeric: tabular-nums
            </code>{" "}
            so columns align. Negative amounts use the true minus sign (−), not a hyphen. Body copy never drops below
            12.5px.
          </p>
        </Section>

        <div className="grid gap-5">
          <Section index="03" eyebrow="Spacing & radius" title="4px base, square corners, hard offset">
            <div className="grid gap-2">
              {spaceSamples.map((sample) => (
                <div key={sample.px} className="flex items-center gap-3">
                  <span className="w-[52px] shrink-0 font-mono text-[11px] text-muted">{sample.px}</span>
                  <span className={`h-2.5 rounded-none ${sample.barClass}`} />
                  <span className="text-xs text-muted">{sample.use}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3 pt-1">
              {radiusSamples.map((sample) => (
                <div key={sample.cssVar} className="grid justify-items-center gap-1">
                  <div
                    className={`h-10 w-[52px] border-2 border-primary/20 bg-accent-surface ${sample.className}`}
                  />
                  <span className="font-mono text-[11px] text-muted">{sample.value}</span>
                  <span className="text-xs font-semibold text-ink">{sample.name}</span>
                </div>
              ))}
            </div>
            <div className="grid gap-2 pt-1">
              {shadowSamples.map((sample) => (
                <p key={sample.cssVar} className="text-[12.5px] leading-6 text-muted">
                  <span className="font-semibold text-ink">{sample.name}</span>{" "}
                  <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">{sample.cssVar}</code>
                  {" — "}
                  {sample.value} using primary or ink, no blur.
                </p>
              ))}
              <p className="text-[12.5px] leading-6 text-muted">
                Backdrop grid is {gridSample.px}px via{" "}
                <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">{gridSample.cssVar}</code>
                . Tailwind <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">--radius-full</code>{" "}
                is also 0 so <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11.5px]">rounded-full</code>{" "}
                becomes a rectangle.
              </p>
            </div>
            <p className="text-[12.5px] leading-6 text-muted">
              Every corner role is 0 — mark, inner, card, and pill. Don’t invent a fifth radius.
            </p>
          </Section>
        </div>
      </div>

      <Section index="04" eyebrow="Layout grid" title="One shell, four page grids">
        <div className="grid gap-2 rounded-[var(--radius-inner)] border-2 border-primary/20 bg-accent-surface px-4 py-3.5 text-[12.5px] leading-normal text-ink-soft">
          <p className="font-display text-base uppercase text-primary-strong">Fixed for every page</p>
          <p>
            Desktop shell <span className="font-bold text-ink">1240px</span> · padding{" "}
            <span className="font-bold text-ink">28px</span> · gutter{" "}
            <span className="font-bold text-ink">20px</span>
            {" — "}
            mobile <span className="font-bold text-ink">390px</span> · padding{" "}
            <span className="font-bold text-ink">20px</span> · gutter{" "}
            <span className="font-bold text-ink">14px</span>
          </p>
          <p>Column count changes per page; shell, gutter and card radius never do.</p>
        </div>

        <div className="grid gap-3.5">
          <LayoutPage
            name="Dashboard"
            spec="4 × 1fr, then three body options"
            note="One Dashboard grid. Stat strip stays 4-up. Three body options: full width, 1.66fr / 1fr, or half/half."
          >
            <div className="grid grid-cols-4 gap-2">
              <WireTile />
              <WireTile />
              <WireTile />
              <WireTile />
            </div>
            <p className="text-[11px] font-semibold text-muted">1 · full 1fr</p>
            <WireTile height="h-[58px]" fill="bg-chart-4" />
            <p className="text-[11px] font-semibold text-muted">2 · 1.66fr / 1fr</p>
            <div className="grid grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)] gap-2">
              <WireTile height="h-[58px]" fill="bg-chart-4" />
              <WireTile height="h-[58px]" />
            </div>
            <p className="text-[11px] font-semibold text-muted">3 · 1fr / 1fr</p>
            <div className="grid grid-cols-2 gap-2">
              <WireTile height="h-[58px]" fill="bg-chart-4" />
              <WireTile height="h-[58px]" />
            </div>
          </LayoutPage>

          <LayoutPage
            name="Transactions"
            spec="full bleed, single column"
            note="Filter strip then one table card. Columns: date 92px, merchant auto, category 140px, account 160px, amount right-aligned 120px."
          >
            <div className="h-[18px] w-[62%] rounded-[var(--radius-pill)] border border-primary/15 bg-accent-surface" />
            <WireTile height="h-[72px]" fill="bg-chart-4" />
          </LayoutPage>

          <LayoutPage
            name="Detail & settings"
            spec="720px max, 1fr / 1fr"
            note="Forms cap at 720px and centre in the shell. Paired fields split 1fr / 1fr; anything longer than a date stays full width."
          >
            <div className="mx-auto grid w-[64%] gap-2">
              <WireTile height="h-[22px]" />
              <div className="grid grid-cols-2 gap-2">
                <WireTile height="h-[34px]" />
                <WireTile height="h-[34px]" />
              </div>
            </div>
          </LayoutPage>

          <LayoutPage
            name="Mobile — any page"
            spec="390px, 1 column"
            note="Desktop body columns stack in rail order; the 4-up stat strip becomes a 2 × 2."
          >
            <div className="mx-auto grid w-24 gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <WireTile height="h-3.5" />
                <WireTile height="h-3.5" />
                <WireTile height="h-3.5" />
                <WireTile height="h-3.5" />
              </div>
              <WireTile height="h-[34px]" fill="bg-chart-4" />
              <WireTile height="h-5" />
            </div>
          </LayoutPage>
        </div>
      </Section>

      <Section
        index="05"
        eyebrow="Components"
        title="The real chrome"
        hint="These are the product components, not restyled stand-ins."
      >
        <div className="grid gap-6">
          <div className="grid gap-3">
            <p className="font-display text-base uppercase text-muted">Buttons</p>
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
              <code className="font-mono text-[11px]">bg-primary</code>. Secondary is a lined surface square. Labels use
              Silkscreen. Hover is the shared 160ms opacity. Disabled keeps the label and mutes the fill.
            </p>
          </div>

          <div className="grid gap-3">
            <p className="font-display text-base uppercase text-muted">Nav labels</p>
            <nav className="flex flex-wrap items-center gap-1">
              {["Dashboard", "Transactions", "Categories", "Budgeting", "Review"].map((label) => (
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
            <p className="font-display text-base uppercase text-muted">Period filter chips</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-1 font-display text-base uppercase text-muted">Period</p>
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
            <p className="font-display text-base uppercase text-muted">Cards and SummaryCard</p>
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
                <ul className="mt-4 divide-y divide-line text-sm">
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
            <p className="font-display text-base uppercase text-muted">Logo mark</p>
            <div className="flex flex-wrap items-center gap-6">
              <BrandMark />
              <span aria-hidden className="grid grid-cols-2 gap-px">
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-primary" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-chart-4" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-secondary" />
                <span className="h-2.5 w-2.5 rounded-[var(--radius-mark)] bg-primary-strong" />
              </span>
              <p className="text-[12.5px] text-muted">
                Four squares — Brand, Brand 300, Brand 400, Brand deep — radius 0, 1px gap.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section index="06" eyebrow="Language and colour" title="Do and don’t">
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
          <p className="font-display text-base uppercase text-muted">
            {index} · {eyebrow}
          </p>
          <h2 className="mt-1.5 font-display text-2xl">{title}</h2>
        </div>
        {hint ? <p className="max-w-sm text-right text-[12.5px] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function LayoutPage({
  name,
  spec,
  note,
  children,
}: {
  name: string;
  spec: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <span className="text-[12.5px] font-semibold">{name}</span>
        <span className="font-mono text-[11px] text-muted">{spec}</span>
      </div>
      <div className="grid gap-2 rounded-[var(--radius-inner)] border-2 border-dashed border-primary/30 bg-surface-subtle p-2">
        {children}
      </div>
      <p className="text-[11.5px] text-muted">{note}</p>
    </div>
  );
}

function WireTile({ fill = "bg-accent-surface", height = "h-6" }: { fill?: string; height?: string }) {
  return (
    <div className={`${height} rounded-[var(--radius-inner)] border-2 border-primary/15 ${fill}`} />
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
    <div className="flex items-baseline gap-[18px] border-b border-line py-3 last:border-b-0">
      <span className="w-[112px] shrink-0 font-mono text-[11px] text-muted">{spec}</span>
      <span className={sampleClass}>{children}</span>
    </div>
  );
}

function Guidance({ doText, dontText }: { doText: string; dontText: string }) {
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <div className="grid gap-1.5 rounded-[var(--radius-inner)] border-2 border-primary/20 bg-accent-surface p-4">
        <p className="font-display text-base uppercase text-primary-strong">Do</p>
        <p className="text-[12.5px] leading-relaxed text-ink-soft">{doText}</p>
      </div>
      <div className="grid gap-1.5 rounded-[var(--radius-inner)] border-2 border-line bg-surface-subtle p-4">
        <p className="font-display text-base uppercase text-muted">Don’t</p>
        <p className="text-[12.5px] leading-relaxed text-ink-soft">{dontText}</p>
      </div>
    </div>
  );
}
