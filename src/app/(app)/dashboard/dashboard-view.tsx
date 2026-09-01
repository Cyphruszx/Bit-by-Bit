"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { DocumentScopeBar } from "@/components/document-scope";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SavingsPathChart } from "@/components/savings-charts";
import { useSavingsPots } from "@/components/savings-store";
import { TagChartCard } from "@/components/tag-charts";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatSignedAud } from "@/lib/format";
import {
  ALL_DOCUMENTS,
  filterByDocument,
  parseDocumentScope,
  parseDocumentView,
  sourceFilesFrom,
  totalsByDocument,
  type DocumentScope,
  type DocumentTotals,
  type DocumentView,
} from "@/lib/money-flow/documents";
import { potsInTotal } from "@/lib/money-flow/savings";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { ChartKind } from "@/lib/money-flow/tag-charts";
import { primaryTag, subTags, tagsOf } from "@/lib/money-flow/tags";
import type { MoneyFlowSummary } from "@/lib/money-flow/types";

const DOC_VIEW_KEY = "bitbybit.dashboard-documents-v1";

export function DashboardView() {
  const { files, flow, hasUploads, transactions, usingDemo } = useMoneyFlow();
  const { pots, snapshots } = useSavingsPots();
  const included = potsInTotal(pots);
  const hiddenCount = pots.length - included.length;
  const [chart, setChart] = useState<ChartKind>("bar");
  const docs = useSyncExternalStore(subscribeDocs, getDocs, () => defaultDocs);
  const sourceFiles = useMemo(() => sourceFilesFrom(transactions), [transactions]);
  const scope = parseDocumentScope(docs.scope, sourceFiles);
  const view = sourceFiles.length > 1 ? docs.view : "together";
  const scopeKey = `${view}:${scope.kind === "file" ? scope.sourceFile : "all"}`;
  const [chartTag, setChartTag] = useState({ key: scopeKey, tag: "All" });
  const selectedTag = chartTag.key === scopeKey ? chartTag.tag : "All";
  const setSelectedTag = (tag: string) => setChartTag({ key: scopeKey, tag });
  const scopedTransactions = useMemo(
    () => (view === "together" ? filterByDocument(transactions, scope) : transactions),
    [scope, transactions, view],
  );
  const scopedFlow = useMemo(() => {
    if (view !== "together" || scope.kind === "all") return flow;
    const next = summarizeMoneyFlow(scopedTransactions);
    next.periodLabel = flow.periodLabel;
    return next;
  }, [flow, scope.kind, scopedTransactions, view]);
  const separate = useMemo(() => totalsByDocument(files, transactions), [files, transactions]);
  const recentSource = view === "together" ? scopedTransactions : transactions;
  const recent = useMemo(() => {
    const rows = selectedTag === "All" ? recentSource : recentSource.filter((txn) => tagsOf(txn).includes(selectedTag));
    return rows.slice(0, 4);
  }, [recentSource, selectedTag]);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{scopedFlow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-[#60716a]">
        {usingDemo
          ? "Sample activity until you upload a statement, spreadsheet, PDF, or photo of a document."
          : view === "separate"
            ? "Totals for each uploaded document, still using the period filter above."
            : scope.kind === "file"
              ? `Money flow from ${scope.sourceFile}.`
              : "Money flow interpreted from the documents you uploaded."}
      </p>
      <DocumentScopeBar
        sourceFiles={sourceFiles}
        view={view}
        scope={scope}
        onView={(next) => writeDocs({ view: next, scope })}
        onScope={(next) => writeDocs({ view: "together", scope: next })}
      />
      {view === "separate" && sourceFiles.length > 1 ? (
        <div className="mt-8 space-y-6">
          {separate.map((entry) => (
            <DocumentSnapshot key={entry.sourceFile} entry={entry} periodLabel={flow.periodLabel} />
          ))}
        </div>
      ) : (
        <CashCards flow={scopedFlow} hasUploads={hasUploads} />
      )}
      {view === "together" ? (
        <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
          <h2 className="text-lg font-bold">How the money moved</h2>
          <ul className="mt-4 space-y-2 text-[#52625c]">
            {scopedFlow.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </article>
      ) : null}
      <section className="mt-8">
        <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Savings</h2>
            <Link href="/savings" className="text-sm font-semibold text-[#355a3f]">
              View all
            </Link>
          </div>
          <div className="mt-5">
            {pots.length === 0 ? (
              <p className="text-sm text-[#60716a]">Add a pot on the Savings tab.</p>
            ) : included.length === 0 ? (
              <p className="text-sm text-[#60716a]">
                All pots are hidden from the total.{" "}
                <Link href="/savings" className="font-semibold text-[#355a3f]">
                  Include one on Savings
                </Link>
                .
              </p>
            ) : (
              <>
                <SavingsPathChart pots={included} snapshots={hiddenCount === 0 ? snapshots : []} compact />
                {hiddenCount > 0 ? (
                  <p className="mt-3 text-sm text-[#60716a]">
                    Showing {included.length} of {pots.length} pots. Hidden pots stay off this total.
                  </p>
                ) : null}
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {included.map((pot) => {
                    const percent = pot.target > 0 ? Math.round((pot.saved / pot.target) * 100) : 0;
                    return (
                      <div key={pot.id}>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{pot.name}</span>
                          <span className="text-[#60716a]">
                            {formatAud(pot.saved)} / {formatAud(pot.target)}
                          </span>
                        </div>
                        <ProgressBar value={percent} />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </article>
      </section>
      {view === "together" ? (
        <>
          <section className="mt-8">
            <TagChartCard
              categories={scopedFlow.categories}
              transactions={scopedTransactions}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              chart={chart}
              onChartChange={setChart}
            />
          </section>
          <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {selectedTag === "All" ? "Recent transactions" : `Recent · ${selectedTag}`}
              </h2>
              <Link href="/transactions" className="text-sm font-semibold text-[#355a3f]">
                View all
              </Link>
            </div>
            <div className="mt-5 divide-y divide-[#edf0ee]">
              {recent.length === 0 ? (
                <p className="py-4 text-sm text-[#60716a]">
                  {selectedTag === "All" ? "No movements in this period." : `No ${selectedTag} movements in this period.`}
                </p>
              ) : (
                recent.map((txn) => (
                  <div className="flex items-center justify-between gap-4 py-4" key={txn.id}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{txn.merchant}</p>
                      <p className="mt-1 truncate text-sm text-[#77857f]">
                        {primaryTag(txn)}
                        {subTags(txn).length > 0 ? ` / ${subTags(txn).join(" · ")}` : ""} · {txn.date}
                      </p>
                    </div>
                    <p className={`shrink-0 font-semibold tabular-nums ${txn.amount > 0 ? "text-[#257155]" : ""}`}>
                      {formatSignedAud(txn.amount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </article>
        </>
      ) : null}
    </>
  );
}

function CashCards({ flow, hasUploads, compact = false }: { flow: MoneyFlowSummary; hasUploads: boolean; compact?: boolean }) {
  return (
    <section className={`grid gap-4 sm:grid-cols-3 ${compact ? "mt-4" : "mt-8"}`}>
      <SummaryCard label="Money in" value={formatAud(flow.cashIn)} detail="Every credit on the statement" positive compact={compact} />
      <SummaryCard label="Money out" value={formatAud(flow.cashOut)} detail="Every debit on the statement" compact={compact} />
      <SummaryCard
        label="Net cash flow"
        value={formatAud(flow.cashNet)}
        detail={
          flow.transfers > 0
            ? `Spending ${formatAud(flow.spending)} · transfers ${formatAud(flow.transfers)}`
            : hasUploads
              ? `${flow.transactionCount} interpreted movements`
              : "Credits minus debits"
        }
        positive={flow.cashNet >= 0}
        compact={compact}
      />
    </section>
  );
}

function DocumentSnapshot({ entry, periodLabel }: { entry: DocumentTotals; periodLabel: string }) {
  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{periodLabel}</p>
      <h2 className="mt-1 truncate text-lg font-bold">{entry.label}</h2>
      {entry.processingError ? <p className="mt-2 text-sm text-[#9b3b32]">{entry.processingError}</p> : null}
      <p className="mt-1 text-sm text-[#60716a]">
        {entry.flow.transactionCount} movement{entry.flow.transactionCount === 1 ? "" : "s"} in this document.
      </p>
      <CashCards flow={entry.flow} hasUploads compact />
      {entry.flow.insights.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-[#52625c]">
          {entry.flow.insights.slice(0, 2).map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

const listeners = new Set<() => void>();
const defaultDocs: { view: DocumentView; scope: DocumentScope } = { view: "together", scope: ALL_DOCUMENTS };
let cachedRaw: string | null | undefined;
let cachedDocs = defaultDocs;

function subscribeDocs(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getDocs() {
  try {
    const raw = localStorage.getItem(DOC_VIEW_KEY);
    if (raw === cachedRaw) return cachedDocs;
    cachedRaw = raw;
    if (!raw) {
      cachedDocs = defaultDocs;
      return defaultDocs;
    }
    const parsed = JSON.parse(raw) as { view?: unknown; scope?: unknown };
    cachedDocs = {
      view: parseDocumentView(parsed.view),
      scope: typeof parsed.scope === "object" && parsed.scope ? (parsed.scope as DocumentScope) : ALL_DOCUMENTS,
    };
    return cachedDocs;
  } catch {
    cachedDocs = defaultDocs;
    return defaultDocs;
  }
}

function writeDocs(next: { view: DocumentView; scope: DocumentScope }) {
  const raw = JSON.stringify(next);
  localStorage.setItem(DOC_VIEW_KEY, raw);
  cachedRaw = raw;
  cachedDocs = next;
  listeners.forEach((listener) => listener());
}
