"use client";

import { useState } from "react";
import { TransactionTable } from "@/components/transaction-table";
import { TagChartCard } from "@/components/tag-charts";
import { SummaryCard } from "@/components/summary-card";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { allPrimaryTags, allSubTags, tagsOf } from "@/lib/money-flow/tags";
import type { ChartKind } from "@/lib/money-flow/tag-charts";

export function TransactionsView() {
  const { allTransactions, flow, hasUploads, removeTagEverywhere, renameTagEverywhere, transactions, usingDemo } =
    useMoneyFlow();
  const [chart, setChart] = useState<ChartKind>("bar");
  const [selectedTag, setSelectedTag] = useState("All");

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        {usingDemo
          ? "Track money in and out on sample activity, or upload documents to interpret your own. Set a primary tag for totals, then an optional sub-tag for detail."
          : hasUploads
            ? "Money in and out from your uploaded documents. Charts use the primary tag so sub-tags never double-count."
            : "Sample activity with your tag edits, saved in this browser."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Money in" value={formatAud(flow.cashIn)} detail="Every credit on the statement" positive />
        <SummaryCard label="Money out" value={formatAud(flow.cashOut)} detail="Every debit on the statement" />
        <SummaryCard
          label="Net"
          value={formatAud(flow.cashNet)}
          detail={`${flow.transactionCount} movements`}
          positive={flow.cashNet >= 0}
        />
      </section>
      <div className="mt-8">
        <TagChartCard
          categories={flow.categories}
          transactions={transactions}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          chart={chart}
          onChartChange={setChart}
        />
      </div>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <TransactionTable transactions={transactions} tag={selectedTag} onTagChange={setSelectedTag} />
      </article>
      <TagManager
        transactions={allTransactions}
        onRename={renameTagEverywhere}
        onRemove={removeTagEverywhere}
      />
    </>
  );
}

function TagManager({
  transactions,
  onRename,
  onRemove,
}: {
  transactions: ReturnType<typeof useMoneyFlow>["transactions"];
  onRename: (from: string, to: string) => void;
  onRemove: (name: string) => void;
}) {
  const primaries = allPrimaryTags(transactions);
  const subs = allSubTags(transactions);
  const tags = [...primaries, ...subs.filter((tag) => !primaries.includes(tag))];
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const primaryCounts = new Map<string, number>();
  const subCounts = new Map<string, number>();
  for (const txn of transactions) {
    const names = tagsOf(txn);
    const primary = names[0];
    if (primary) primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1);
    for (const tag of names.slice(1)) {
      subCounts.set(tag, (subCounts.get(tag) ?? 0) + 1);
    }
  }

  return (
    <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <h2 className="text-lg font-bold">Tags</h2>
      <p className="mt-1 text-sm text-[#60716a]">
        Primary tags drive spending and income totals. Sub-tags are extra detail and never add to those totals.
      </p>
      <div className="mt-5 divide-y divide-[#edf0ee]">
        {tags.map((tag) => (
          <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={tag}>
            {editing === tag ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRename(tag, draft);
                  setEditing(null);
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-label={`Rename ${tag}`}
                  className="rounded-full border border-[#dce4df] px-3 py-1.5 text-sm outline-none focus:border-[#173b31]"
                />
                <button type="submit" className="text-sm font-semibold text-[#355a3f]">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className="text-sm text-[#60716a]">
                  Cancel
                </button>
              </form>
            ) : (
              <div>
                <p className="font-semibold">{tag}</p>
                <p className="text-sm text-[#77857f]">
                  {primaryCounts.get(tag)
                    ? `Primary on ${primaryCounts.get(tag)} transaction${primaryCounts.get(tag) === 1 ? "" : "s"}`
                    : null}
                  {primaryCounts.get(tag) && subCounts.get(tag) ? " · " : null}
                  {subCounts.get(tag)
                    ? `Sub-tag on ${subCounts.get(tag)} transaction${subCounts.get(tag) === 1 ? "" : "s"}`
                    : null}
                </p>
              </div>
            )}
            {editing === tag ? null : (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-sm font-semibold text-[#355a3f]"
                  onClick={() => {
                    setEditing(tag);
                    setDraft(tag);
                  }}
                >
                  Rename
                </button>
                <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={() => onRemove(tag)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}
