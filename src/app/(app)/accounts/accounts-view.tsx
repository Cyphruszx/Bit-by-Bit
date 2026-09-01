"use client";

import Link from "next/link";
import { demoAccounts, useMoneyFlow } from "@/components/money-flow-provider";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";

export function AccountsView() {
  const { files, flow, hasUploads } = useMoneyFlow();
  const total = demoAccounts.reduce((sum, account) => sum + account.balance, 0);
  const completed = files.filter((file) => file.processingStatus === "completed").length;

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">
        {hasUploads ? flow.periodLabel : "Upload to interpret"}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts and sources</h1>
      <p className="mt-2 text-[#60716a]">
        {hasUploads
          ? "Documents already interpreted in this browser. The period filter changes the net flow from those files."
          : "Placeholder balances until you upload statements. Use the period filter on Dashboard and Transactions to slice sample activity."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label={hasUploads ? "Interpreted net flow" : "Net across accounts"}
          value={formatAud(hasUploads ? flow.cashNet : total)}
          detail={hasUploads ? flow.periodLabel : "Everyday, savings, and card"}
          positive
        />
        <SummaryCard label="Accounts in view" value={String(demoAccounts.length)} detail="Demo institutions only" />
        <SummaryCard
          label="Documents interpreted"
          value={String(completed)}
          detail="CSV, Excel, PDF, OFX, images, and more"
        />
      </section>
      {files.length > 0 ? (
        <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Uploaded documents</h2>
            <Link href="/upload" className="text-sm font-semibold text-[#355a3f]">
              Upload more
            </Link>
          </div>
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {files.map((file) => (
              <div className="flex items-center justify-between py-3" key={file.filename}>
                <div>
                  <p className="font-semibold">{file.filename}</p>
                  <p className="mt-1 text-sm text-[#77857f]">
                    {file.kind.toUpperCase()} · {file.processingStatus}
                    {file.transactionCount ? ` · ${file.transactionCount} movements` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}
      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {demoAccounts.map((account) => (
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
