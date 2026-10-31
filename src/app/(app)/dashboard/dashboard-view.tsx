"use client";

import { useMemo } from "react";
import { BankAccountsCard } from "@/components/bank-accounts-card";
import { Card } from "@/components/card";
import { DashboardBudgetCard } from "@/components/dashboard-budget-card";
import { EmptyLedger } from "@/components/empty-ledger";
import { rehydrateLedger, useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud, formatSignedAud } from "@/lib/format";
import { accountsByInstitution } from "@/lib/money-flow/accounts";
import { monthPlan, spentByCategoryKey } from "@/lib/money-flow/budget-plan";
import { dashboardRingCard } from "@/lib/money-flow/budget-rings";
import { bankInstitutionTiles } from "@/lib/money-flow/dashboard";
import { APP_TIME_ZONE, filterByPeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { poolBookOf } from "@/lib/money-flow/pools";
import { categoryOf } from "@/lib/money-flow/tags";
import { moneyInOutRows } from "@/lib/money-flow/summary";

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
    loadError,
    payers,
    period,
    ready,
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
  const budgetMonth = period.kind === "month" ? period.month : sydneyMonth();
  const ringCard = useMemo(() => {
    const spent = spentByCategoryKey(filterByPeriod(allTransactions, { kind: "month", month: budgetMonth }));
    return dashboardRingCard(categoryBook, monthPlan(budgets, budgetMonth), spent, budgetMonth);
  }, [allTransactions, budgetMonth, budgets, categoryBook]);
  const accountCount = tiles.reduce((sum, tile) => sum + tile.accounts.length, 0);
  const categoryCount = useMemo(() => {
    const rows = moneyInOutRows(filterByPeriod(allTransactions, period)).filter((txn) => txn.amount < 0);
    return new Set(rows.map((txn) => categoryOf(txn))).size;
  }, [allTransactions, period]);

  if (!ready) {
    return <DashboardBudgetCard card={{ status: "empty" }} status="loading" />;
  }
  if (loadError && !hasUploads) {
    return (
      <DashboardBudgetCard
        card={{ status: "empty" }}
        status="error"
        onRetry={() => void rehydrateLedger()}
      />
    );
  }
  if (!hasUploads) {
    return (
      <EmptyLedger>
        Once a statement is read, this page shows what actually came in and went out across every
        account, with money you moved between your own accounts counted once.
      </EmptyLedger>
    );
  }

  return (
    <div className="grid gap-5">
      <Card title="This month">
        <div className="grid gap-6 sm:grid-cols-3">
          <MonthStat
            label="Money in"
            value={formatAud(flow.cashIn)}
            detail={movementDetail(period, flow.periodLabel, accountCount, "account")}
          />
          <MonthStat
            label="Money out"
            value={formatAud(flow.cashOut)}
            detail={movementDetail(period, flow.periodLabel, categoryCount, "category")}
          />
          <MonthStat
            label="Net"
            value={formatSignedAud(flow.cashNet)}
            detail="Money in less money out"
          />
        </div>
      </Card>

      <BankAccountsCard tiles={tiles} />

      <DashboardBudgetCard
        card={ringCard}
        status={loadError ? "error" : "ready"}
        onRetry={() => void rehydrateLedger()}
      />
    </div>
  );
}

function MonthStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-[14px] text-muted">{label}</p>
      <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-2 text-[12px] text-muted">{detail}</p>
    </div>
  );
}

function movementDetail(period: PeriodFilter, periodLabel: string, count: number, noun: "account" | "category"): string {
  const word = count === 1 ? noun : noun === "account" ? "accounts" : "categories";
  if (period.kind !== "month") return periodLabel;
  return `${shortMonth(period.month)} · ${count} ${word}`;
}

function shortMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const label = new Date(Date.UTC(year, monthNumber - 1, 15, 12)).toLocaleDateString("en-AU", {
    month: "short",
    timeZone: APP_TIME_ZONE,
  });
  return label.replace(/\.$/, "");
}

function sydneyMonth(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
}
