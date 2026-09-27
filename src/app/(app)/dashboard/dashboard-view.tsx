"use client";

import { useMemo } from "react";
import { BankAccountsCard } from "@/components/bank-accounts-card";
import { BudgetBars } from "@/components/budget-bars";
import { EmptyLedger } from "@/components/empty-ledger";
import { FeatureEnableOffer, OptionalFeaturesPanel } from "@/components/feature-enable-offer";
import { LineChart } from "@/components/line-chart";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { useSavingsPots } from "@/components/savings-store";
import { SavingsRings } from "@/components/savings-rings";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatCount, formatSignedAud } from "@/lib/format";
import { accountsByInstitution, accountsFrom } from "@/lib/money-flow/accounts";
import {
  asOfHint,
  bankInstitutionTiles,
  budgetRowsFromPrior,
  monthlyBalanceSeries,
  presentAccountTiles,
  snapshotAsOfDate,
} from "@/lib/money-flow/dashboard";
import {
  APP_TIME_ZONE,
  daysLeftInMonth,
  filterByPeriod,
  lastTwelveMonths,
  monthsFromDates,
  previousPeriod,
  shiftMonth,
} from "@/lib/money-flow/period";
import { poolBookOf } from "@/lib/money-flow/pools";
import { potsInTotal } from "@/lib/money-flow/savings";
import { spendByCategory } from "@/lib/money-flow/summary";

export function DashboardView() {
  const {
    accountMeta,
    accountNames,
    accountPoolMembers,
    accountPools,
    allTransactions,
    flow,
    hasUploads,
    institutionOverrides,
    payers,
    period,
    mergedInto,
  } = useMoneyFlow();
  const { pots } = useSavingsPots();
  const included = potsInTotal(pots);
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const groups = useMemo(() => accountsByInstitution(allTransactions, registry), [allTransactions, registry]);
  const book = useMemo(
    () => poolBookOf(accountPools, accountPoolMembers),
    [accountPoolMembers, accountPools],
  );
  const tiles = useMemo(
    () => bankInstitutionTiles(groups, { meta: accountMeta, mergedInto, book }),
    [accountMeta, book, groups, mergedInto],
  );
  const accounts = useMemo(() => accountsFrom(allTransactions, registry), [allTransactions, registry]);
  const endMonth = monthsFromDates(allTransactions.map((txn) => txn.dateIso))[0] ?? currentMonth();
  const months = useMemo(() => lastTwelveMonths(endMonth), [endMonth]);
  const balancePoints = useMemo(
    () => monthlyBalanceSeries(allTransactions, months),
    [allTransactions, months],
  );
  const yearChange = (balancePoints.at(-1)?.value ?? 0) - (balancePoints[0]?.value ?? 0);
  const priorFilter = previousPeriod(period.kind === "all" ? { kind: "month", month: endMonth } : period);
  const priorCategories = useMemo(
    () => (priorFilter ? spendByCategory(filterByPeriod(allTransactions, priorFilter)) : []),
    [allTransactions, priorFilter],
  );
  const budgets = budgetRowsFromPrior(flow.categories, priorCategories);
  const daysLeft = period.kind === "month" ? daysLeftInMonth(period.month, todayIso()) : null;
  const totalBalance = useMemo(() => presentAccountTiles(tiles), [tiles]);
  const asOf = useMemo(
    () => snapshotAsOfDate(allTransactions, tiles, accountMeta, mergedInto),
    [accountMeta, allTransactions, mergedInto, tiles],
  );
  const accountCount = `Across ${formatCount(accounts.length)} account${accounts.length === 1 ? "" : "s"}`;

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

      <div className="grid gap-5">
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Money in"
            value={formatAud(flow.cashIn)}
            detail={flow.periodLabel}
            positive
          />
          <SummaryCard
            label="Money out"
            value={`−${formatAud(flow.cashOut)}`}
            detail={flow.periodLabel}
          />
          <SummaryCard
            label="Net"
            value={formatSignedAud(flow.cashNet)}
            detail={flow.periodLabel}
            positive={flow.cashNet > 0}
          />
          <SummaryCard
            label="Total balance"
            value={totalBalance.amount == null ? (totalBalance.label ?? "—") : formatAud(totalBalance.amount)}
            detail={
              totalBalance.amount == null
                ? (totalBalance.prompt ?? accountCount)
                : [
                    [asOf ? asOfHint(asOf) : null, totalBalance.label, totalBalance.warning, accountCount]
                      .filter(Boolean)
                      .join(". "),
                    totalBalance.excludedNote,
                  ]
                    .filter(Boolean)
                    .join(". ")
            }
          />
        </section>

        <BankAccountsCard tiles={tiles} />

        <BudgetBars rows={budgets} daysLeft={daysLeft} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)] lg:items-start">
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
              ]}
            />
          </article>
          <SavingsRings pots={included} />
        </div>
      </div>

      <OptionalFeaturesPanel />
    </>
  );
}

function currentMonth(): string {
  return shiftMonth(`${new Date().getUTCFullYear()}-01`, new Date().getUTCMonth());
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
