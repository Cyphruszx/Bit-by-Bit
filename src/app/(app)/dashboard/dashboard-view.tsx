"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ScopeBar } from "@/components/scope-bar";
import { useScope, writeScope } from "@/components/scope-store";
import { SavingsPathChart } from "@/components/savings-charts";
import { useSavingsPots } from "@/components/savings-store";
import { TagChartCard } from "@/components/tag-charts";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { accountsByInstitution, type InstitutionAccounts } from "@/lib/money-flow/accounts";
import { describeScope, filterByScope } from "@/lib/money-flow/scope";
import { potsInTotal } from "@/lib/money-flow/savings";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { ChartKind } from "@/lib/money-flow/tag-charts";
import type { MoneyFlowSummary } from "@/lib/money-flow/types";

export function DashboardView() {
  const { accountNames, flow, hasUploads, institutionOverrides, transactions, usingDemo } = useMoneyFlow();
  const { pots, snapshots } = useSavingsPots();
  const included = potsInTotal(pots);
  const hiddenCount = pots.length - included.length;
  const [chart, setChart] = useState<ChartKind>("bar");
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides }),
    [accountNames, institutionOverrides],
  );
  const groups = useMemo(() => accountsByInstitution(transactions, registry), [registry, transactions]);
  const known = useMemo(
    () => ({
      institutions: groups.map((group) => group.institution),
      accounts: groups.flatMap((group) => group.accounts.map((account) => account.id)),
    }),
    [groups],
  );
  const held = useScope(known);
  const scope = held.scope;
  const view = groups.length > 1 ? held.view : "together";
  const scopeKey = `${view}:${JSON.stringify(scope)}`;
  const [chartTag, setChartTag] = useState({ key: scopeKey, tag: "All" });
  const selectedTag = chartTag.key === scopeKey ? chartTag.tag : "All";
  const setSelectedTag = (tag: string) => setChartTag({ key: scopeKey, tag });
  const scopedTransactions = useMemo(
    () => (view === "together" ? filterByScope(transactions, scope, registry) : transactions),
    [registry, scope, transactions, view],
  );
  const scopedFlow = useMemo(() => {
    if (view !== "together" || scope.kind === "all") return flow;
    const next = summarizeMoneyFlow(scopedTransactions);
    next.periodLabel = flow.periodLabel;
    return next;
  }, [flow, scope.kind, scopedTransactions, view]);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{scopedFlow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-[#60716a]">
        {usingDemo
          ? "Sample activity until you upload a statement, spreadsheet, PDF, or photo of a document."
          : view === "separate"
            ? "Each bank on its own, and the accounts inside it, still using the period filter above."
            : describeScope(scope)}
      </p>
      <ScopeBar
        groups={groups}
        view={view}
        scope={scope}
        onView={(next) => writeScope({ view: next, scope })}
        onScope={(next) => writeScope({ view: "together", scope: next })}
      />
      {view === "separate" && groups.length > 1 ? (
        <div className="mt-8 space-y-6">
          {groups.map((group) => (
            <InstitutionSnapshot key={group.institution} group={group} periodLabel={flow.periodLabel} />
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

function InstitutionSnapshot({ group, periodLabel }: { group: InstitutionAccounts; periodLabel: string }) {
  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{periodLabel}</p>
      <h2 className="mt-1 truncate text-lg font-bold">{group.institution}</h2>
      <p className="mt-1 text-sm text-[#60716a]">
        {group.flow.transactionCount} movement{group.flow.transactionCount === 1 ? "" : "s"} across{" "}
        {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}.
      </p>
      <CashCards flow={group.flow} hasUploads compact />
      <div className="mt-4 divide-y divide-[#edf0ee]">
        {group.accounts.map((account) => (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2" key={account.id}>
            <p className="text-sm font-semibold">{account.label}</p>
            <p className="text-sm text-[#60716a]">
              <span className="tabular-nums">{formatAud(account.flow.cashIn)}</span> in ·{" "}
              <span className="tabular-nums">{formatAud(account.flow.cashOut)}</span> out ·{" "}
              <span className="font-semibold tabular-nums text-[#17211e]">{formatAud(account.flow.cashNet)}</span> net
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}
