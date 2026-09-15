"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { LinkedBalancesWidget } from "@/components/shell-widgets";
import { useShell } from "@/components/shell-store";
import { accountsByInstitution } from "@/lib/money-flow/accounts";

export function LinkedBalancesView() {
  const { enabled } = useShell();
  const { accountNames, institutionOverrides, payers, transactions, mergedInto } = useMoneyFlow();
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
      <h1 className="text-3xl font-bold tracking-tight">Linked balances</h1>
      <p className="mt-2 text-muted">Live CLEARED view. Not Actual Savings. Does not write the ledger.</p>
      {enabled.linkedBalances ? (
        <LinkedBalancesWidget accounts={accounts} />
      ) : (
        <p className="mt-8 text-sm text-muted">
          Linked balances stay off until you enable them from the dashboard after the first CLEARED
          row.{" "}
          <Link href="/dashboard" className="font-semibold text-ink-soft underline">
            Customise on Dashboard
          </Link>
        </p>
      )}
    </>
  );
}
