"use client";

import { useMemo } from "react";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { CustomiseShell, EnableOffer, GoalsWidget, LinkedBalancesWidget } from "@/components/shell-widgets";
import { useShell } from "@/components/shell-store";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { accountsByInstitution } from "@/lib/money-flow/accounts";
import type { MoneyFlowSummary } from "@/lib/money-flow/types";
import { enableOffer, hasFirstCleared, visibleWidgets } from "@/lib/shell/core-shell";

export function DashboardView() {
  const { accountNames, flow, hasUploads, institutionOverrides, payers, transactions, mergedInto } =
    useMoneyFlow();
  const shell = useShell();
  const firstCleared = hasFirstCleared(transactions);
  const offer = enableOffer(shell, firstCleared);
  const shown = visibleWidgets(shell);
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const accounts = useMemo(
    () =>
      accountsByInstitution(transactions, registry).flatMap((group) =>
        group.accounts.map((account) => ({
          id: account.id,
          label: account.label,
          net: account.flow.net,
        })),
      ),
    [registry, transactions],
  );

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-muted">
        What actually came in and went out across every account, with money you moved between them
        counted once.
      </p>

      <EnableOffer items={offer} />
      <CustomiseShell firstCleared={firstCleared} />

      {shown.map((id) => {
        if (id === "money-tiles") {
          return hasUploads ? (
            <FlowCards key={id} flow={flow} hasUploads={hasUploads} />
          ) : (
            <EmptyLedger key={id}>
              An empty dashboard is fine. Once a statement is read, Spec 10 money tiles land here.
            </EmptyLedger>
          );
        }
        if (id === "goals") return <GoalsWidget key={id} />;
        return <LinkedBalancesWidget key={id} accounts={accounts} />;
      })}
    </>
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
          detail={
            flow.refunds > 0
              ? `Income − Spending + ${formatAud(flow.refunds)} refund credits`
              : hasUploads
                ? `${flow.transactionCount} movements`
                : "Income − Spending"
          }
          positive={flow.net >= 0}
          compact={compact}
        />
      </section>
      {flow.transfers > 0 ? (
        <p className={`${compact ? "mt-2" : "mt-3"} text-sm text-muted`}>
          {formatAud(flow.transfers)} moved between these accounts, counted once. The statements
          themselves show {formatAud(flow.cashIn)} in and {formatAud(flow.cashOut)} out.
        </p>
      ) : null}
    </>
  );
}
