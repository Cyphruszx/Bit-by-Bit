"use client";

import { useMemo, useState } from "react";
import { TransactionTable } from "@/components/transaction-table";
import { TagChartCard } from "@/components/tag-charts";
import { SummaryCard } from "@/components/summary-card";
import { EmptyLedger } from "@/components/empty-ledger";
import { LearnedList } from "@/components/learned-list";
import { ReviewQueue } from "@/components/review-queue";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ScopeBar } from "@/components/scope-bar";
import { SettledMoney, UnsettledMoney } from "@/components/unsettled-money";
import { setScope, useScope } from "@/components/scope-store";
import { formatAud } from "@/lib/format";
import { accountsByInstitution } from "@/lib/money-flow/accounts";
import { describeScope, filterByScope } from "@/lib/money-flow/scope";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import { allTags, tagsOf } from "@/lib/money-flow/tags";
import type { ChartKind } from "@/lib/money-flow/tag-charts";

export function TransactionsView() {
  const {
    accountNames,
    allTransactions,
    flow,
    hasUploads,
    institutionOverrides,
    payers,
    removeTagEverywhere,
    renameTagEverywhere,
    transactions,
  } = useMoneyFlow();
  const [chart, setChart] = useState<ChartKind>("bar");
  const [selectedTag, setSelectedTag] = useState("All");
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers }),
    [accountNames, institutionOverrides, payers],
  );
  const groups = useMemo(() => accountsByInstitution(transactions, registry), [registry, transactions]);
  const known = useMemo(
    () => ({
      institutions: groups.map((group) => group.institution),
      accounts: groups.flatMap((group) => group.accounts.map((account) => account.id)),
    }),
    [groups],
  );
  const scope = useScope(known);
  const scoped = useMemo(() => filterByScope(transactions, scope, registry), [registry, scope, transactions]);
  const scopedFlow = useMemo(() => {
    if (scope.kind === "all") return flow;
    const next = summarizeMoneyFlow(scoped);
    next.periodLabel = flow.periodLabel;
    return next;
  }, [flow, scope.kind, scoped]);

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <EmptyLedger>
          Every movement BitbyBit reads will be listed here, searchable and sortable, each with one
          category for what the money was for and any tags you want to find it by.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#60716a]">
        Money in and out from your uploaded documents. Charts group by category, so nothing is
        counted twice and money you moved, borrowed or paid back stays out of the totals.
      </p>
      <ScopeBar groups={groups} scope={scope} onScope={setScope} />
      <p className="mt-3 text-sm text-[#60716a]">{describeScope(scope)}</p>
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Money in"
          value={formatAud(scopedFlow.income)}
          detail="Income, not counting money from your own accounts"
          positive
          compact
        />
        <SummaryCard
          label="Money out"
          value={formatAud(scopedFlow.spending)}
          detail="What you actually spent"
          compact
        />
        <SummaryCard
          label="Net"
          value={formatAud(scopedFlow.net)}
          detail={`${scopedFlow.transactionCount} movements`}
          positive={scopedFlow.net >= 0}
          compact
        />
      </section>
      <ReviewQueue transactions={scoped} />
      <UnsettledMoney transactions={scoped} />
      <SettledMoney transactions={scoped} />
      <div className="mt-4">
        <TagChartCard
          transactions={scoped}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          chart={chart}
          onChartChange={setChart}
          compact
        />
      </div>
      <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
        <h2 className="text-base font-bold">Transactions</h2>
        <p className="mt-0.5 text-xs text-[#60716a]">
          Every movement in this period — one row each, so the same shop appears as many times as you
          paid it. Change one and you are offered the rest.
        </p>
        <div className="mt-3">
          <TransactionTable transactions={scoped} tag={selectedTag} onTagChange={setSelectedTag} />
        </div>
      </article>
      <LearnedList />
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
  const tags = allTags(transactions);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const counts = new Map<string, number>();
  for (const txn of transactions) {
    for (const tag of tagsOf(txn)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return (
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Your tags</h2>
          <p className="mt-0.5 text-xs text-[#60716a]">
            Tags are yours to invent — anything you want to find a movement by. They never change a
            total; that is what the category on each movement is for.
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
        {tags.length === 0 ? (
          <p className="py-2 text-sm text-[#60716a]">
            No tags yet. Add one to any movement and it will show up here.
          </p>
        ) : null}
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
                  On {counts.get(tag) ?? 0} transaction{counts.get(tag) === 1 ? "" : "s"}
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
