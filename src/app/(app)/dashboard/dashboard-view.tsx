"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BudgetBars } from "@/components/budget-bars";
import { DashboardLedger } from "@/components/dashboard-ledger";
import { EmptyLedger } from "@/components/empty-ledger";
import { FeatureEnableOffer, OptionalFeaturesPanel } from "@/components/feature-enable-offer";
import { LineChart } from "@/components/line-chart";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { PoolsWidget } from "@/components/pools-widget";
import { showEveryInstitution, toggleInstitution, useHiddenInstitutions } from "@/components/scope-store";
import { useSavingsPots } from "@/components/savings-store";
import { SpendDonut } from "@/components/spend-donut";
import { SavingsRings } from "@/components/savings-rings";
import { TagChartCard } from "@/components/tag-charts";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatCount, formatSignedAud } from "@/lib/format";
import { accountsByInstitution, accountsFrom, type AccountTotals, type InstitutionAccounts } from "@/lib/money-flow/accounts";
import {
  budgetRowsFromPrior,
  monthlyBalanceSeries,
  monthlySpendingSeries,
  payRunCount,
  recentLedgerRows,
  spendDonutSlices,
} from "@/lib/money-flow/dashboard";
import { incomeSources, type IncomeSource } from "@/lib/money-flow/income";
import {
  APP_TIME_ZONE,
  daysLeftInMonth,
  filterByPeriod,
  lastTwelveMonths,
  monthsFromDates,
  previousPeriod,
  shiftMonth,
  summarizePeriod,
} from "@/lib/money-flow/period";
import { potsInTotal } from "@/lib/money-flow/savings";
import { spendByCategory } from "@/lib/money-flow/summary";
import type { ChartKind } from "@/lib/money-flow/tag-charts";

export function DashboardView() {
  const { accountNames, allTransactions, flow, hasUploads, institutionOverrides,
    payers, period, transactions, mergedInto } = useMoneyFlow();
  const { pots } = useSavingsPots();
  const included = potsInTotal(pots);
  const [chart, setChart] = useState<ChartKind>("bar");
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const groups = useMemo(() => accountsByInstitution(transactions, registry), [registry, transactions]);
  const sources = useMemo(() => incomeSources(transactions), [transactions]);
  const hidden = useHiddenInstitutions();
  const [chartTag, setChartTag] = useState({ key: "All", tag: "All" });
  const selectedTag = chartTag.tag;
  const setSelectedTag = (tag: string) => setChartTag({ key: "All", tag });
  const shown = groups.filter((group) => !hidden.includes(group.institution));
  const accounts = useMemo(() => accountsFrom(allTransactions, registry), [allTransactions, registry]);
  const endMonth = monthsFromDates(allTransactions.map((txn) => txn.dateIso))[0] ?? currentMonth();
  const months = useMemo(() => lastTwelveMonths(endMonth), [endMonth]);
  const balancePoints = useMemo(
    () => monthlyBalanceSeries(allTransactions, months),
    [allTransactions, months],
  );
  const spendPoints = useMemo(
    () => monthlySpendingSeries(allTransactions, months),
    [allTransactions, months],
  );
  const yearChange = (balancePoints.at(-1)?.value ?? 0) - (balancePoints[0]?.value ?? 0);
  const ledgerRows = useMemo(
    () => recentLedgerRows(transactions, registry),
    [registry, transactions],
  );
  const slices = spendDonutSlices(flow.categories);
  const priorFilter = previousPeriod(period.kind === "all" ? { kind: "month", month: endMonth } : period);
  const priorCategories = useMemo(
    () => (priorFilter ? spendByCategory(filterByPeriod(allTransactions, priorFilter)) : []),
    [allTransactions, priorFilter],
  );
  const budgets = budgetRowsFromPrior(flow.categories, priorCategories);
  const daysLeft = period.kind === "month" ? daysLeftInMonth(period.month, todayIso()) : null;
  const pays = payRunCount(transactions);
  const allFlow = useMemo(() => summarizePeriod(allTransactions, { kind: "all" }), [allTransactions]);
  const setAside = included.reduce((sum, pot) => sum + pot.saved, 0) || flow.actualSavings;
  const spendShare = flow.income > 0 ? Math.round((flow.spending / flow.income) * 100) : 0;

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight">Your financial snapshot</h1>
        <EmptyLedger>
          Once a statement is read, this page shows what actually came in and went out across every
          account, with money you moved between your own accounts counted once.
        </EmptyLedger>
        <OptionalFeaturesPanel />
      </>
    );
  }

  return (
    <>
      <FeatureEnableOffer />

      <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total balance"
          value={formatAud(allFlow.net)}
          detail={`Across ${formatCount(accounts.length)} account${accounts.length === 1 ? "" : "s"}`}
        />
        <SummaryCard
          label="Money in"
          value={formatSignedAud(flow.income)}
          detail={pays > 0 ? `${formatCount(pays)} pay run${pays === 1 ? "" : "s"} this period` : "Income, not counting money from your own accounts"}
          positive
        />
        <SummaryCard
          label="Money out"
          value={`−${formatAud(flow.spending)}`}
          detail={flow.income > 0 ? `${spendShare}% of money in` : "What you actually spent"}
        />
        <SummaryCard
          label="Set aside"
          value={formatAud(setAside)}
          detail={included.length > 0 ? "Moved to savings pots" : "Actual savings this period"}
          highlight
        />
      </section>
      {flow.transfers > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {formatAud(flow.transfers)} moved between these accounts, counted once. The statements
          themselves show {formatAud(flow.cashIn)} in and {formatAud(flow.cashOut)} out.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-5">
          <article className="card p-[22px]">
            <div className="mb-3.5 flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-[15.5px] font-bold">Balance over 12 months</h3>
                <p className="mt-0.5 text-[12.5px] text-muted">All accounts combined, end of each month</p>
              </div>
              <span className="text-[12.5px] font-semibold text-positive">{formatSignedAud(yearChange)} this year</span>
            </div>
            <LineChart
              ariaLabel="Line graph of total balance by month"
              series={[
                {
                  id: "balance",
                  label: "Balance",
                  color: "var(--color-positive)",
                  fill: "var(--color-positive)",
                  points: balancePoints,
                },
                {
                  id: "spend",
                  label: "Spending baseline",
                  color: "var(--color-muted)",
                  dashed: true,
                  points: spendPoints,
                },
              ]}
            />
          </article>
          <DashboardLedger rows={ledgerRows} periodLabel={flow.periodLabel} count={flow.transactionCount} />
        </div>

        <div className="grid gap-5">
          <article className="card p-[22px]">
            <h3 className="text-[15.5px] font-bold">Spend by category</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">{flow.periodLabel}</p>
            {slices.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No money out in this period.</p>
            ) : (
              <div className="mt-4">
                <SpendDonut slices={slices} total={flow.spending} caption={flow.periodLabel} />
              </div>
            )}
          </article>
          <BudgetBars rows={budgets} daysLeft={daysLeft} />
          <SavingsRings pots={included} />
        </div>
      </div>

      <IncomeBreakdown sources={sources} income={flow.income} />

      {groups.length > 0 ? (
        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">Where it sits</h2>
            {hidden.length > 0 ? (
              <p className="text-sm text-muted">
                {hidden.length} bank{hidden.length === 1 ? "" : "s"} hidden, still counted above.{" "}
                <button type="button" onClick={showEveryInstitution} className="font-semibold text-ink-soft underline">
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
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-dashed px-6 py-4"
            >
              <p className="text-sm font-semibold text-muted">{institution} · hidden</p>
              <button
                type="button"
                onClick={() => toggleInstitution(institution)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft"
              >
                Show
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <article className="card mt-8 p-6">
        <h2 className="text-lg font-bold">How the money moved</h2>
        <ul className="mt-4 space-y-2 text-muted">
          {flow.insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      </article>
      <PoolsWidget />
      <section className="mt-8">
        <TagChartCard
          transactions={transactions}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          chart={chart}
          onChartChange={setChart}
        />
      </section>
      <OptionalFeaturesPanel />
    </>
  );
}

function IncomeBreakdown({ sources, income }: { sources: IncomeSource[]; income: number }) {
  if (sources.length < 2) return null;

  return (
    <section className="card mt-5 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-bold">What&apos;s in money in</h2>
        <p className="text-sm text-muted">
          <span className="tabular-nums">{formatAud(income)}</span> from {sources.length} places
        </p>
      </div>
      <ul className="mt-4 space-y-3">
        {sources.map((source) => (
          <li key={source.kind}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="text-sm font-semibold">
                {source.label}
                <span className="ml-2 font-normal text-muted">
                  {source.count} movement{source.count === 1 ? "" : "s"}
                </span>
              </p>
              <p className="text-sm font-semibold tabular-nums text-positive">{formatAud(source.amount)}</p>
            </div>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              {source.detail}
              {source.askable ? (
                <>
                  {" "}
                  <Link href="/transactions" className="font-semibold text-ink-soft underline">
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

function InstitutionSection({ group, onHide }: { group: InstitutionAccounts; onHide: () => void }) {
  return (
    <article className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{group.institution}</h3>
          <p className="mt-0.5 text-sm text-muted">
            {group.flow.transactionCount} movement{group.flow.transactionCount === 1 ? "" : "s"} across{" "}
            {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            <span className="tabular-nums text-positive">{formatAud(group.flow.income)}</span> in ·{" "}
            <span className="tabular-nums">{formatAud(group.flow.spending)}</span> out ·{" "}
            <span className="font-semibold tabular-nums text-ink">{formatAud(group.flow.net)}</span> net
          </p>
          <button
            type="button"
            onClick={onHide}
            className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="mt-4 divide-y divide-surface-subtle">
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
      <p className="text-sm text-muted">
        <span className="tabular-nums text-positive">{formatAud(account.flow.income)}</span> in ·{" "}
        <span className="tabular-nums">{formatAud(account.flow.spending)}</span> out ·{" "}
        <span className="font-semibold tabular-nums text-ink">{formatAud(account.flow.net)}</span> net
      </p>
    </div>
  );
}

function currentMonth(): string {
  return shiftMonth(`${new Date().getUTCFullYear()}-01`, new Date().getUTCMonth());
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
