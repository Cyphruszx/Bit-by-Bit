"use client";

import type { ReactNode } from "react";
import { groupReviewRows } from "@/lib/money-flow/review-inspector";
import type { ReviewOpenAction } from "@/lib/money-flow/review-page";

export type ReviewSplitRow = {
  id: string;
  group: string;
  dateLabel: string;
  title: string;
  caption: string;
  amountLabel: string;
};

export function ReviewAnswerList({
  actions,
  onAction,
}: {
  actions: ReviewOpenAction[];
  onAction: (id: ReviewOpenAction["id"]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          onClick={() => onAction(action.id)}
          className={
            action.role === "primary"
              ? "flex min-h-11 w-full items-center rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-left text-sm font-semibold text-on-primary shadow-card disabled:cursor-not-allowed disabled:opacity-50"
              : "flex min-h-11 w-full items-center rounded-[4px] border-2 border-line bg-surface px-4 text-left text-sm font-semibold text-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function ReviewSplit({
  status,
  rows,
  selectedId,
  onSelect,
  onClose,
  inspector,
  empty,
  error,
  onRetry,
}: {
  status: "loading" | "ready";
  rows: ReviewSplitRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  inspector: ReactNode;
  empty?: { title: string; body: string; note?: string; actions?: ReactNode } | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (status === "ready" && empty) {
    return (
      <div data-review-empty className="flex flex-col items-center px-6 py-16 text-center">
        <h2 className="text-[28px] font-bold tracking-[-0.4px] text-ink">{empty.title}</h2>
        <p className="mt-3 max-w-md text-sm text-muted">{empty.body}</p>
        {empty.note ? <p className="mt-3 max-w-md text-sm text-muted">{empty.note}</p> : null}
        {empty.actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{empty.actions}</div> : null}
      </div>
    );
  }

  const open = status === "ready" && selectedId !== null;
  const sheet = open;
  const panelClass = sheet
    ? "fixed inset-x-0 bottom-0 z-40 max-h-[min(85vh,640px)] w-full overflow-y-auto rounded-t-[4px] border-2 border-primary bg-surface p-5 pb-28 text-ink shadow-card md:static md:z-auto md:max-h-none md:w-[400px] md:shrink-0 md:overflow-visible md:rounded-[4px] md:pb-5"
    : error
      ? "w-full rounded-[4px] border-2 border-primary bg-surface p-5 text-ink shadow-card md:w-[400px] md:shrink-0"
      : "hidden w-[400px] shrink-0 rounded-[4px] border-2 border-primary bg-surface p-5 text-ink shadow-card md:block";

  return (
    <>
      {sheet ? (
        <button type="button" aria-label="Close inspector" className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={onClose} />
      ) : null}
      <div className="flex flex-wrap items-start gap-4 md:flex-nowrap">
        <div className="w-full min-w-0 flex-1">
          {status === "loading" ? <LedgerSkeleton /> : <Ledger rows={rows} selectedId={selectedId} onSelect={onSelect} />}
          {status === "loading" ? <p className="mt-3 text-[13px] text-muted md:hidden">Loading your items…</p> : null}
        </div>
        <aside
          aria-label="Review inspector"
          data-review-sheet={sheet ? "true" : "false"}
          className={panelClass}
        >
          {sheet ? (
            <button
              type="button"
              onClick={onClose}
              className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary md:hidden"
            >
              Close
            </button>
          ) : null}
          <InspectorBody error={error} onRetry={onRetry} loading={status === "loading"} idle={!open && status !== "loading"}>
            {open ? inspector : null}
          </InspectorBody>
        </aside>
      </div>
    </>
  );
}

function Ledger({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ReviewSplitRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = groupReviewRows(rows);
  return (
    <div className="overflow-hidden rounded-[4px] border-2 border-line bg-surface">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="flex h-11 items-center gap-2 border-b-2 border-line bg-surface-subtle px-4">
            <span className="text-[13px] font-bold text-ink">{group.label}</span>
            <span className="inline-flex size-6 min-w-6 items-center justify-center rounded-[4px] bg-accent-surface px-1.5 text-xs font-bold text-primary-strong">
              {group.rows.length}
            </span>
          </div>
          {group.rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <button
                key={row.id}
                type="button"
                data-row-id={row.id}
                data-selected={selected ? "true" : "false"}
                aria-pressed={selected}
                onClick={() => onSelect(row.id)}
                className={`relative flex min-h-14 w-full items-center gap-3 border-t-2 border-line px-4 py-2 text-left ${
                  selected ? "bg-accent-surface" : "bg-surface"
                }`}
              >
                {selected ? <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden /> : null}
                <span className="w-[52px] shrink-0 text-[13px] text-muted">{row.dateLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{row.title}</span>
                  <span className="block truncate text-xs text-muted">{row.caption}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{row.amountLabel}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div data-review-skeleton className="overflow-hidden rounded-[4px] border-2 border-line bg-surface" aria-hidden>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex h-14 items-center gap-3 border-t-2 border-line px-4 first:border-t-0">
          <span className="h-3 w-11 rounded-[4px] bg-surface-subtle" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 w-2/3 rounded-[4px] bg-surface-subtle" />
            <span className="h-2.5 w-1/3 rounded-[4px] bg-line" />
          </span>
          <span className="h-3 w-16 rounded-[4px] bg-surface-subtle" />
        </div>
      ))}
    </div>
  );
}

function InspectorBody({
  error,
  onRetry,
  loading,
  idle,
  children,
}: {
  error?: string | null;
  onRetry?: () => void;
  loading: boolean;
  idle: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-inspector-open={idle || loading ? "false" : "true"}
      className="flex flex-col gap-4"
    >
      {error ? (
        <div data-review-error className="flex flex-col gap-3">
          <h2 className="text-xl font-bold text-ink">We couldn’t load your review items</h2>
          <p className="text-sm text-muted">{error}</p>
          <p className="text-sm text-muted">Nothing you’ve answered is lost. Check your connection and try again.</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center justify-center rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-sm font-semibold text-on-primary shadow-card"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden>
          <span className="h-5 w-28 rounded-[4px] bg-surface-subtle" />
          <span className="h-6 w-3/4 rounded-[4px] bg-surface-subtle" />
          <span className="h-3 w-1/2 rounded-[4px] bg-line" />
          <span className="h-12 w-full rounded-[4px] bg-surface-subtle" />
          <p className="text-[13px] text-muted">Loading your items…</p>
        </div>
      ) : null}
      {idle && !error ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold text-ink">Pick a row to answer it</h2>
          <p className="text-[13.5px] leading-normal text-muted">
            Each item asks one question. Your answer only saves when you press it here, never from the list.
          </p>
        </div>
      ) : null}
      {children}
    </div>
  );
}
