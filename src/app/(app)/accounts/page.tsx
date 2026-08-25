import type { Metadata } from "next";
import { SummaryCard } from "@/components/summary-card";
import { accounts } from "@/lib/demo-data";
import { formatAud } from "@/lib/format";

export const metadata: Metadata = {
  title: "Accounts",
};

export default function AccountsPage() {
  const total = accounts.reduce((sum, account) => sum + account.balance, 0);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Connected later</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts</h1>
      <p className="mt-2 text-[#60716a]">
        Placeholder balances for the demo. File uploads and live bank connections arrive in later checkpoints.
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Net across accounts" value={formatAud(total)} detail="Everyday, savings, and card" positive />
        <SummaryCard label="Accounts in view" value={String(accounts.length)} detail="Demo institutions only" />
        <SummaryCard label="Uploads processed" value="0" detail="CSV, XLSX, PDF, and images" />
      </section>
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {accounts.map((account) => (
          <article key={account.id} className="rounded-2xl border border-[#dce4df] bg-white p-6">
            <p className="text-sm text-[#60716a]">{account.institution}</p>
            <h2 className="mt-1 text-lg font-bold">{account.name}</h2>
            <p className="mt-4 text-2xl font-bold">{formatAud(account.balance)}</p>
            <p className="mt-1 text-sm text-[#77857f]">{account.accountType}</p>
          </article>
        ))}
      </section>
    </>
  );
}
