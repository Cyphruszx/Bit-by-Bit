"use client";

import { useMemo } from "react";
import { BankAccountsCard } from "@/components/bank-accounts-card";
import { BudgetBars } from "@/components/budget-bars";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatCount, formatSignedAud } from "@/lib/format";
import { accountsByInstitution, accountsFrom } from "@/lib/money-flow/accounts";
import {
  asOfHint,
  bankInstitutionTiles,
  budgetRowsFromPrior,
  presentAccountTiles,
  snapshotAsOfDate,
} from "@/lib/money-flow/dashboard";
import {
  APP_TIME_ZONE,
  daysLeftInMonth,
  filterByPeriod,
  monthsFromDates,
  previousPeriod,
  shiftMonth,
} from "@/lib/money-flow/period";
import { poolBookOf } from "@/lib/money-flow/pools";
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

        <BudgetBars rows={budgets} daysLeft={daysLeft} />
      </div>
    </>
  );
}

function currentMonth(): string {
  return shiftMonth(`${new Date().getUTCFullYear()}-01`, new Date().getUTCMonth());
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
