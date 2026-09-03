"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { showEveryInstitution, toggleInstitution, useHiddenInstitutions } from "@/components/scope-store";
import { SavingsPathChart } from "@/components/savings-charts";
import { useSavingsPots } from "@/components/savings-store";
import { TagChartCard } from "@/components/tag-charts";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { accountsByInstitution, type AccountTotals, type InstitutionAccounts } from "@/lib/money-flow/accounts";
import { incomeSources, type IncomeSource } from "@/lib/money-flow/income";
import { potsInTotal } from "@/lib/money-flow/savings";
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
  const sources = useMemo(() => incomeSources(transactions), [transactions]);
  const hidden = useHiddenInstitutions();
  const [chartTag, setChartTag] = useState({ key: "All", tag: "All" });
  const selectedTag = chartTag.tag;
  const setSelectedTag = (tag: string) => setChartTag({ key: "All", tag });
  const shown = groups.filter((group) => !hidden.includes(group.institution));

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-[#60716a]">
        {usingDemo
          ? "Sample activity until you upload a statement, spreadsheet, PDF, or photo of a document."
          : "What actually came in and went out across every account, with money you moved between them counted once."}
      </p>

      <FlowCards flow={flow} hasUploads={hasUploads} />

      <IncomeBreakdown sources={sources} income={flow.income} />

      {groups.length > 0 ? (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">Where it sits</h2>
            {hidden.length > 0 ? (
              <p className="text-sm text-[#60716a]">
                {hidden.length} bank{hidden.length === 1 ? "" : "s"} hidden, still counted above.{" "}
                <button type="button" onClick={showEveryInstitution} className="font-semibold text-[#355a3f] underline">
                  Show all
                </button>
              </p>
            ) : null}
          </div>
          {shown.map((group) => (
            <InstitutionSection
              key={group.institution}
              group={group}
              onHide={() => toggleInstitution(group.institution)}
            />
          ))}
          {hidden.map((institution) => (
            <div
              key={institution}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[#c3d2ca] px-6 py-4"
            >
              <p className="text-sm font-semibold text-[#60716a]">{institution} · hidden</p>
              <button
                type="button"
                onClick={() => toggleInstitution(institution)}
                className="rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
              >
                Show
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">How the money moved</h2>
        <ul className="mt-4 space-y-2 text-[#52625c]">
          {flow.insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      </article>
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
      <section className="mt-8">
        <TagChartCard
          categories={flow.categories}
          transactions={transactions}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          chart={chart}
          onChartChange={setChart}
        />
      </section>
    </>
  );
}

/**
 * Money in is what came in, not every credit on the statement: moving $500 from one of
 * your accounts to another is not income, and counting it as both income and spending is
 * the thing this app exists to stop. The statement's own credits and debits stay
 * underneath, because that is what ties a figure back to the bank.
 */
/**
 * What the money-in figure is made of. A single number cannot be argued with: a person who
 * knows what they earn can see a total is wrong but not which part of it, and the part
 * that is wrong is usually one a bank mislabelled or an account they have not added yet.
 */
function IncomeBreakdown({ sources, income }: { sources: IncomeSource[]; income: number }) {
  // One source is the whole figure, and saying so twice explains nothing.
  if (sources.length < 2) return null;

  return (
    <section className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-bold">What&apos;s in money in</h2>
        <p className="text-sm text-[#60716a]">
          <span className="tabular-nums">{formatAud(income)}</span> from {sources.length} places
        </p>
      </div>
      <ul className="mt-4 space-y-3">
        {sources.map((source) => (
          <li key={source.kind}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="text-sm font-semibold">
                {source.label}
                <span className="ml-2 font-normal text-[#60716a]">
                  {source.count} movement{source.count === 1 ? "" : "s"}
                </span>
              </p>
              <p className="text-sm font-semibold tabular-nums text-[#257155]">{formatAud(source.amount)}</p>
            </div>
            <p className="mt-0.5 max-w-2xl text-sm text-[#60716a]">
              {source.detail}
              {source.askable ? (
                <>
                  {" "}
                  <Link href="/transactions" className="font-semibold text-[#355a3f] underline">
                    Tell us what these are
                  </Link>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlowCards({
  flow,
  hasUploads,
  compact = false,
}: {
  flow: MoneyFlowSummary;
  hasUploads: boolean;
  compact?: boolean;
}) {
  return (
    <>
      <section className={`grid gap-4 sm:grid-cols-3 ${compact ? "mt-4" : "mt-8"}`}>
        <SummaryCard
          label="Money in"
          value={formatAud(flow.income)}
          detail="Income, not counting money from your own accounts"
          positive
          compact={compact}
        />
        <SummaryCard
          label="Money out"
          value={formatAud(flow.spending)}
          detail="What you actually spent"
          compact={compact}
        />
        <SummaryCard
          label="Net"
          value={formatAud(flow.net)}
          detail={hasUploads ? `${flow.transactionCount} movements` : "Money in minus money out"}
          positive={flow.net >= 0}
          compact={compact}
        />
      </section>
      {flow.transfers > 0 ? (
        <p className={`${compact ? "mt-2" : "mt-3"} text-sm text-[#60716a]`}>
          {formatAud(flow.transfers)} moved between these accounts, counted once. The statements
          themselves show {formatAud(flow.cashIn)} in and {formatAud(flow.cashOut)} out.
        </p>
      ) : null}
    </>
  );
}

/**
 * A bank, its own income and spending, and the accounts inside it. The bank's figures are
 * not the sum of its accounts': money moved between two of them cancels here and counts
 * in each account on its own, because from inside one account it really did leave.
 */
function InstitutionSection({ group, onHide }: { group: InstitutionAccounts; onHide: () => void }) {
  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{group.institution}</h3>
          <p className="mt-0.5 text-sm text-[#60716a]">
            {group.flow.transactionCount} movement{group.flow.transactionCount === 1 ? "" : "s"} across{" "}
            {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-[#60716a]">
            <span className="tabular-nums text-[#257155]">{formatAud(group.flow.income)}</span> in ·{" "}
            <span className="tabular-nums">{formatAud(group.flow.spending)}</span> out ·{" "}
            <span className="font-semibold tabular-nums text-[#17211e]">{formatAud(group.flow.net)}</span> net
          </p>
          <button
            type="button"
            onClick={onHide}
            className="rounded-full border border-[#dce4df] px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="mt-4 divide-y divide-[#edf0ee]">
        {group.accounts.map((account) => (
          <AccountRow key={account.id} account={account} institution={group.institution} />
        ))}
      </div>
    </article>
  );
}

function AccountRow({ account, institution }: { account: AccountTotals; institution: string }) {
  const prefix = `${institution} · `;
  const name = account.label.startsWith(prefix) ? account.label.slice(prefix.length) : account.label;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <p className="text-sm font-semibold">{name}</p>
      <p className="text-sm text-[#60716a]">
        <span className="tabular-nums text-[#257155]">{formatAud(account.flow.income)}</span> in ·{" "}
        <span className="tabular-nums">{formatAud(account.flow.spending)}</span> out ·{" "}
        <span className="font-semibold tabular-nums text-[#17211e]">{formatAud(account.flow.net)}</span> net
      </p>
    </div>
  );
}
