import type { Metadata } from "next";
import { TransactionTable } from "@/components/transaction-table";
import { periodLabel } from "@/lib/demo-data";

export const metadata: Metadata = {
  title: "Transactions",
};

export default function TransactionsPage() {
  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Transactions</h1>
      <p className="mt-2 text-[#60716a]">Search and filter placeholder activity before live bank files are connected.</p>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <TransactionTable />
      </article>
    </>
  );
}
