"use client";

import { TransactionTable } from "@/components/transaction-table";
import { useMoneyFlow } from "@/components/money-flow-provider";

export function TransactionsView() {
  const { flow, transactions, usingDemo } = useMoneyFlow();

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-2 text-[#60716a]">
        {usingDemo
          ? "Search sample activity, or upload documents to interpret your own money movement."
          : "Activity extracted from your uploaded documents."}
      </p>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <TransactionTable transactions={transactions} />
      </article>
    </>
  );
}
