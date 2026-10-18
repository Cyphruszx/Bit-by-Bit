"use client";

import { useMemo } from "react";
import { BankAccountsCard } from "@/components/bank-accounts-card";
import { DashboardBudgetCard } from "@/components/dashboard-budget-card";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatCount, formatSignedAud } from "@/lib/format";
import { accountsByInstitution, accountsFrom } from "@/lib/money-flow/accounts";
import { dashboardBudgetCard, monthPlan, spentByCategoryKey } from "@/lib/money-flow/budget-plan";
import { asOfHint, bankInstitutionTiles, presentAccountTiles, snapshotAsOfDate } from "@/lib/money-flow/dashboard";
import { APP_TIME_ZONE, filterByPeriod } from "@/lib/money-flow/period";
import { poolBookOf } from "@/lib/money-flow/pools";

export function DashboardView() {
  const {
    accountMeta,
    accountNames,
    accountPoolMembers,
    accountPools,
    allTransactions,
    budgets,
    categoryBook,
    flow,
    hasUploads,
    institutionOverrides,
    payers,
    period,
    mergedInto,
  } = useMoneyFlow();
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
  const budgetMonth = period.kind === "month" ? period.month : sydneyMonth();
  const budgetCard = useMemo(() => {
    const spent = spentByCategoryKey(filterByPeriod(allTransactions, { kind: "month", month: budgetMonth }));
    return dashboardBudgetCard(categoryBook, monthPlan(budgets, budgetMonth), spent);
  }, [allTransactions, budgetMonth, budgets, categoryBook]);
  const totalBalance = useMemo(() => presentAccountTiles(tiles), [tiles]);
  const asOf = useMemo(
    () => snapshotAsOfDate(allTransactions, tiles, accountMeta, mergedInto),
    [accountMeta, allTransactions, mergedInto, tiles],
  );
  const accountCount = `Across ${formatCount(accounts.length)} account${accounts.length === 1 ? "" : "s"}`;

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-[32px]">Your financial snapshot</h1>
        <EmptyLedger>
          Once a statement is read, this page shows what actually came in and went out across every
          account, with money you moved between your own accounts counted once.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
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
            value={totalBalance.amount == null ? (totalBalance.label ?? "No balance from your bank.") : formatAud(totalBalance.amount)}
            detail={
              totalBalance.amount == null
                ? accountCount
                : [asOf ? asOfHint(asOf) : null, accountCount].filter(Boolean).join(". ")
            }
          />
        </section>

        <BankAccountsCard tiles={tiles} />

        <DashboardBudgetCard card={budgetCard} />
      </div>
    </>
  );
}

function sydneyMonth(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
}
