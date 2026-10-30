"use client";

import { useMemo, useState } from "react";
import { TransactionTable } from "@/components/transaction-table";
import { TagChartCard } from "@/components/tag-charts";
import { SummaryCard } from "@/components/summary-card";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ScopeBar } from "@/components/scope-bar";
import { SettledMoney, UnsettledMoney } from "@/components/unsettled-money";
import { setScope, useScope } from "@/components/scope-store";
import { formatAud } from "@/lib/format";
import { accountsByInstitution } from "@/lib/money-flow/accounts";
import { presentAccountBalance } from "@/lib/money-flow/dashboard";
import { filterByScope } from "@/lib/money-flow/scope";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";

export function TransactionsView() {
  const {
    accountNames,
    allTransactions,
    flow,
    hasUploads,
    institutionOverrides,
    payers,
    mergedInto,
    accountMeta,
    period,
    transactions,
  } = useMoneyFlow();
  const [selectedTag, setSelectedTag] = useState("All");
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const groups = useMemo(
    () => accountsByInstitution(allTransactions, registry),
    [allTransactions, registry],
  );
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
  const scopedHoldings = useMemo(
    () => filterByScope(allTransactions, scope, registry),
    [allTransactions, registry, scope],
  );
  const accountBalance = useMemo(
    () => presentAccountBalance(scopedHoldings, { meta: accountMeta, mergedInto, registry }),
    [accountMeta, mergedInto, registry, scopedHoldings],
  );

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-2xl">Transactions</h1>
        <EmptyLedger>
          Every movement BitbyBit reads will be listed here, searchable and sortable, each with one
          category for what the money was for.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl">Transactions</h1>
      <div className="mt-4">
        <TagChartCard
          transactions={scopedHoldings}
          pagePeriod={period}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          compact
        />
      </div>
      <ScopeBar groups={groups} scope={scope} onScope={setScope} />
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Money in"
          value={formatAud(scopedFlow.cashIn)}
          detail="Credits in this period"
          positive
          compact
        />
        <SummaryCard
          label="Money out"
          value={formatAud(scopedFlow.cashOut)}
          detail="Debits in this period"
          compact
        />
        <SummaryCard
          label="Account balance"
          value={accountBalance.amount == null ? (accountBalance.label ?? "—") : formatAud(accountBalance.amount)}
          detail={accountBalance.amount == null ? (accountBalance.label ?? "No balance from your bank.") : "Statement balance"}
          positive={accountBalance.amount != null && accountBalance.amount > 0}
          compact
        />
      </section>
      <article className="mt-4 overflow-hidden card p-4">
        <h2 className="text-base font-bold">Transactions</h2>
        <p className="mt-0.5 text-xs text-muted">
          Every movement in this period — one row each, so the same shop appears as many times as you
          paid it. Show statement to put the bank&apos;s own cells beside BitbyBit&apos;s reading. The
          bank&apos;s words are evidence, not the answer.
        </p>
        <div className="mt-3">
          <TransactionTable transactions={scoped} tag={selectedTag} onTagChange={setSelectedTag} />
        </div>
      </article>
      <UnsettledMoney transactions={scoped} />
      <SettledMoney transactions={scoped} />
    </>
  );
}
