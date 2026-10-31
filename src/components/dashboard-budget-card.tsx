"use client";

import Link from "next/link";
import { useState } from "react";
import { BudgetRing } from "@/components/budget-ring";
import { Card, TextHit } from "@/components/card";
import { CategoryDetailSheet, CategoryRingControl } from "@/components/category-ring-detail";
import { formatAud } from "@/lib/format";
import {
  budgetStatusNote,
  overallRingAria,
  ringSummaryLine,
  type DashboardRingCard,
  type UnplannedSpend,
} from "@/lib/money-flow/budget-rings";

const BUDGET_HREF = "/budgeting";

export function DashboardBudgetCard({
  card,
  status = "ready",
  onRetry,
}: {
  card: DashboardRingCard;
  status?: "loading" | "error" | "ready";
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const sheet =
    card.status === "ready" ? (card.rings.find((ring) => ring.key === sheetKey) ?? null) : null;

  if (status === "loading") {
    return (
      <BudgetFrame>
        <Card title="Budget">
          <BudgetSkeleton />
        </Card>
      </BudgetFrame>
    );
  }
  if (status === "error") {
    return (
      <BudgetFrame>
      <Card title="Budget">
        <div className="flex min-h-[480px] flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-[16px] font-semibold text-ink">Couldn&apos;t load your budget.</p>
          <p className="mt-2 text-[14px] text-muted">Check your connection, then try again.</p>
          <button
            type="button"
            className="mt-5 inline-flex h-11 items-center justify-center rounded-[8px] border border-line bg-[var(--card-surface)] px-4 text-[14px] font-semibold text-primary"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      </Card>
      </BudgetFrame>
    );
  }
  if (card.status === "empty") {
    return (
      <BudgetFrame>
      <Card title="Budget">
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <DashedRing />
          <p className="mt-6 text-[16px] font-semibold text-ink">No budget yet</p>
          <p className="mt-2 text-[14px] text-muted">Set amounts to track spending against them.</p>
          <Link
            href={BUDGET_HREF}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-[8px] bg-primary px-4 text-[14px] font-semibold text-on-primary"
          >
            Set a budget
          </Link>
        </div>
      </Card>
      </BudgetFrame>
    );
  }

  const note = budgetStatusNote(card.overCount, card.unplanned.length);
  const ready = card;

  return (
    <BudgetFrame>
    <Card
      title="Budget"
      action={<TextHit href={BUDGET_HREF}>Edit</TextHit>}
    >
      <div className="@min-[1180px]:flex @min-[1180px]:items-start">
        <OverallColumn card={ready} note={note} />
        <div className="mt-8 min-w-0 @min-[1180px]:mt-0 @min-[1180px]:flex-1 @min-[1180px]:border-l @min-[1180px]:border-line @min-[1180px]:pl-8">
          <div
            className={`grid gap-x-2 gap-y-5 ${
              expanded
                ? "grid-cols-2 @min-[640px]:grid-cols-3 @min-[1180px]:grid-cols-4"
                : "grid-cols-3 @min-[1180px]:grid-cols-4"
            }`}
          >
            {ready.rings.map((ring, index) => (
              <div
                key={ring.key}
                className={index >= 3 && !expanded ? "hidden @min-[640px]:block" : undefined}
              >
                <CategoryRingControl ring={ring} onOpenSheet={() => setSheetKey(ring.key)} />
              </div>
            ))}
          </div>
          {ready.rings.length > 3 ? (
            <button
              type="button"
              className="ring-hit -my-2 mt-3 inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-primary @min-[640px]:hidden"
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? "Show less" : `Show all ${ready.rings.length}`}
            </button>
          ) : null}
          {ready.unplanned.length > 0 ? <UnplannedList rows={ready.unplanned} /> : null}
        </div>
      </div>
      {sheet ? <CategoryDetailSheet ring={sheet} onClose={() => setSheetKey(null)} /> : null}
    </Card>
    </BudgetFrame>
  );
}

/** Queries the page content width. About 1,180px is where the split layout starts. */
function BudgetFrame({ children }: { children: React.ReactNode }) {
  return <div className="@container">{children}</div>;
}

function OverallColumn({
  card,
  note,
}: {
  card: Extract<DashboardRingCard, { status: "ready" }>;
  note: string | null;
}) {
  const word = card.over ? "Over" : "Left";
  return (
    <div className="flex w-full flex-col items-center gap-4 @min-[640px]:flex-row @min-[640px]:items-center @min-[1180px]:w-[280px] @min-[1180px]:shrink-0 @min-[1180px]:flex-col">
      <BudgetRing
        planned={card.planned}
        spent={card.spent}
        figure="inside"
        digits="hero"
        ariaLabel={overallRingAria(card.planned, card.spent)}
        boxClassName="w-[140px] aspect-square @min-[640px]:w-[200px]"
      />
      <div className="w-full min-w-0 @min-[640px]:flex-1">
        <p className="text-center text-[20px] font-semibold tabular-nums text-ink @min-[640px]:text-left @min-[1180px]:text-center">
          {ringSummaryLine(card.remainder, card.over, card.planned)}
        </p>
        <div className="my-3 hidden border-t border-line @min-[1180px]:block" />
        <dl className="mt-3 grid grid-cols-3 gap-3 @min-[1180px]:mt-0 @min-[1180px]:grid-cols-1 @min-[1180px]:gap-2">
          <Stat label="Planned" value={formatAud(card.planned)} />
          <Stat label="Spent" value={formatAud(card.spent)} />
          <Stat label={word} value={formatAud(card.remainder)} over={card.over} />
        </dl>
        {note ? (
          <p className="mt-3 text-center text-[12px] text-muted @min-[640px]:text-left @min-[1180px]:text-center">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, over = false }: { label: string; value: string; over?: boolean }) {
  return (
    <div className="flex flex-col items-center @min-[640px]:items-start @min-[1180px]:flex-row @min-[1180px]:items-baseline @min-[1180px]:justify-between">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`text-[14px] tabular-nums ${over ? "font-bold text-primary-strong" : "font-semibold text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

function UnplannedList({ rows }: { rows: UnplannedSpend[] }) {
  const settable = rows.some((row) => row.settable);
  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Not planned yet · {rows.length}</h3>
        {settable ? <TextHit href={BUDGET_HREF}>Set all</TextHit> : null}
      </div>
      <ul className="grid gap-x-8 @min-[720px]:grid-cols-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 border-b border-line py-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{row.label}</p>
              <p className="text-[12px] text-muted">{formatAud(row.spent)} spent</p>
            </div>
            {row.settable ? <TextHit href={BUDGET_HREF}>Set</TextHit> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashedRing() {
  return (
    <svg viewBox="0 0 120 120" className="size-[140px] text-muted @min-[640px]:size-[200px]" aria-hidden>
      <circle
        cx="60"
        cy="60"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeDasharray="2 7"
        strokeLinecap="round"
        opacity={0.55}
      />
    </svg>
  );
}

function BudgetSkeleton() {
  return (
    <div className="min-h-[480px] animate-pulse" aria-busy="true" aria-label="Loading your budget">
      <div className="flex flex-col items-center gap-6 @min-[1180px]:flex-row @min-[1180px]:items-start">
        <div className="size-[140px] rounded-full bg-line @min-[640px]:size-[200px]" />
        <div className="grid w-full flex-1 grid-cols-3 gap-4 @min-[1180px]:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex flex-col items-center gap-2">
              <div className="h-3 w-16 rounded bg-line" />
              <div className="size-[72px] rounded-full bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
