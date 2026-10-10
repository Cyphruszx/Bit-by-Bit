"use client";

import { useMemo } from "react";
import { BudgetBars } from "@/components/budget-bars";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { budgetRowsFromPrior } from "@/lib/money-flow/dashboard";
import {
  APP_TIME_ZONE,
  daysLeftInMonth,
  filterByPeriod,
  monthsFromDates,
  previousPeriod,
  shiftMonth,
} from "@/lib/money-flow/period";
import { spendByCategory } from "@/lib/money-flow/summary";

export function BudgetingView() {
  const { allTransactions, flow, hasUploads, period } = useMoneyFlow();
  const endMonth = monthsFromDates(allTransactions.map((txn) => txn.dateIso))[0] ?? currentMonth();
  const priorFilter = previousPeriod(period.kind === "all" ? { kind: "month", month: endMonth } : period);
  const priorCategories = useMemo(
    () => (priorFilter ? spendByCategory(filterByPeriod(allTransactions, priorFilter)) : []),
    [allTransactions, priorFilter],
  );
  const budgets = budgetRowsFromPrior(flow.categories, priorCategories);
  const daysLeft = period.kind === "month" ? daysLeftInMonth(period.month, todayIso()) : null;

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-[32px]">Budgeting</h1>
        <EmptyLedger>
          Once a statement is read, this page shows spend against last period&apos;s category totals.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[32px]">Budgeting</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Spend this period against what those categories cost last period. Direction stays in the figures, not
        in a new colour.
      </p>
      <div className="mt-6">
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
