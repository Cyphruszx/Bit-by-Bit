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
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#60716a]">
        {usingDemo
          ? "Track money in and out on sample activity, or upload documents to interpret your own. Set a primary tag for totals, then an optional sub-tag for detail."
          : hasUploads
            ? "Money in and out from your uploaded documents. Charts use the primary tag so sub-tags never double-count."
            : "Sample activity with your tag edits, saved in this browser."}
      </p>
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Money in" value={formatAud(flow.income)} detail="Income and refunds" positive compact />
        <SummaryCard label="Money out" value={formatAud(flow.spending)} detail="Spending this period" compact />
        <SummaryCard
          label="Net"
          value={formatAud(flow.net)}
          detail={`${flow.transactionCount} movements`}
          positive={flow.net >= 0}
          compact
        />
      </section>
      <div className="mt-4">
        <TagChartCard
          categories={flow.categories}
          transactions={transactions}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          chart={chart}
          onChartChange={setChart}
          compact
        />
      </div>
      <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
        <h2 className="text-base font-bold">Merchants</h2>
        <p className="mt-0.5 text-xs text-[#60716a]">
          Every movement in this period. Search or filter the list, then tag each merchant.
        </p>
        <div className="mt-3">
          <TransactionTable transactions={transactions} tag={selectedTag} onTagChange={setSelectedTag} />
        </div>
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
  const [open, setOpen] = useState(false);
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
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Tags</h2>
          <p className="mt-0.5 text-xs text-[#60716a]">
            Primary tags drive spending and income totals. Sub-tags are extra detail and never add to those totals.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="tag-manager-list"
          onClick={() => {
            if (open) setEditing(null);
            setOpen(!open);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f]"
        >
          {open ? "Hide" : `Show ${tags.length}`}
          <span aria-hidden="true" className={`inline-block leading-none ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </div>
      <div id="tag-manager-list" hidden={!open} className="mt-3 divide-y divide-[#edf0ee]">
        {tags.map((tag) => (
          <div className="flex flex-wrap items-center justify-between gap-2 py-1.5" key={tag}>
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
                <p className="text-sm font-semibold">{tag}</p>
                <p className="text-xs text-[#77857f]">
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
