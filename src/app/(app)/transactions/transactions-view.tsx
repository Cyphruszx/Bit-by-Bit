"use client";

import { useState } from "react";
import { TransactionTable } from "@/components/transaction-table";
import { SummaryCard } from "@/components/summary-card";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { allTags, tagsOf } from "@/lib/money-flow/tags";

export function TransactionsView() {
  const { flow, hasUploads, removeTagEverywhere, renameTagEverywhere, transactions, usingDemo } = useMoneyFlow();

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        {usingDemo
          ? "Track money in and out on sample activity, or upload documents to interpret your own. Tags replace categories — change them on a transaction or rename them everywhere."
          : hasUploads
            ? "Money in and out from your uploaded documents. Change tags on a transaction, or rename a tag across the whole list."
            : "Sample activity with your tag edits, saved in this browser."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Money in" value={formatAud(flow.income)} detail="Income and refunds" positive />
        <SummaryCard label="Money out" value={formatAud(flow.spending)} detail="Spending this period" />
        <SummaryCard
          label="Net"
          value={formatAud(flow.net)}
          detail={`${flow.transactionCount} movements`}
          positive={flow.net >= 0}
        />
      </section>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <TransactionTable transactions={transactions} />
      </article>
      <TagManager
        transactions={transactions}
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
  const tags = allTags(transactions);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const counts = new Map<string, number>();
  for (const txn of transactions) {
    for (const tag of tagsOf(txn)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return (
    <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <h2 className="text-lg font-bold">Tags</h2>
      <p className="mt-1 text-sm text-[#60716a]">Rename a tag everywhere, or remove it from every transaction.</p>
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
                  {counts.get(tag) ?? 0} transaction{(counts.get(tag) ?? 0) === 1 ? "" : "s"}
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
