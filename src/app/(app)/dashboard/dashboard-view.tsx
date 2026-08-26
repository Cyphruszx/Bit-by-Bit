"use client";

import Link from "next/link";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SavingsPathChart } from "@/components/savings-charts";
import { useSavingsPots } from "@/components/savings-store";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { formatAud, formatSignedAud } from "@/lib/format";
import { potsInTotal } from "@/lib/money-flow/savings";
import { tagsOf } from "@/lib/money-flow/tags";

export function DashboardView() {
  const { flow, hasUploads, transactions, usingDemo } = useMoneyFlow();
  const { pots, snapshots } = useSavingsPots();
  const included = potsInTotal(pots);
  const hiddenCount = pots.length - included.length;
  const recent = transactions.slice(0, 4);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-[#60716a]">
        {usingDemo
          ? "Sample activity until you upload a statement, spreadsheet, PDF, or photo of a document."
          : "Money flow interpreted from the documents you uploaded."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Money in" value={formatAud(flow.income)} detail="Income and refunds" positive />
        <SummaryCard label="Money out" value={formatAud(flow.spending)} detail="Spending this period" />
        <SummaryCard
          label="Net cash flow"
          value={formatAud(flow.net)}
          detail={hasUploads ? `${flow.transactionCount} interpreted movements` : "Income minus spending"}
          positive={flow.net >= 0}
        />
      </section>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">How the money moved</h2>
        <ul className="mt-4 space-y-2 text-[#52625c]">
          {flow.insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      </article>
      <section className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Savings</h2>
            <Link href="/savings" className="text-sm font-semibold text-[#355a3f]">
              View all
            </Link>
          </div>
          <div className="mt-5">
            {pots.length === 0 ? (
              <p className="text-sm text-[#60716a]">Add a pot on the Savings tab.</p>
            ) : included.length === 0 ? (
              <p className="text-sm text-[#60716a]">
                All pots are hidden from the total.{" "}
                <Link href="/savings" className="font-semibold text-[#355a3f]">
                  Include one on Savings
                </Link>
                .
              </p>
            ) : (
              <>
                <SavingsPathChart pots={included} snapshots={hiddenCount === 0 ? snapshots : []} compact />
                {hiddenCount > 0 ? (
                  <p className="mt-3 text-sm text-[#60716a]">
                    Showing {included.length} of {pots.length} pots. Hidden pots stay off this total.
                  </p>
                ) : null}
                <div className="mt-5 space-y-5">
                  {included.map((pot) => {
                    const percent = pot.target > 0 ? Math.round((pot.saved / pot.target) * 100) : 0;
                    return (
                      <div key={pot.id}>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{pot.name}</span>
                          <span className="text-[#60716a]">
                            {formatAud(pot.saved)} / {formatAud(pot.target)}
                          </span>
                        </div>
                        <ProgressBar value={percent} />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </article>
        <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
          <h2 className="text-lg font-bold">Spending by tag</h2>
          <div className="mt-5 space-y-5">
            {flow.categories.length === 0 ? (
              <p className="text-sm text-[#60716a]">No spending in this period.</p>
            ) : (
              flow.categories.slice(0, 4).map((item) => (
                <div key={item.name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-[#60716a]">{formatAud(item.amount)}</span>
                  </div>
                  <ProgressBar value={item.share} />
                </div>
              ))
            )}
          </div>
        </article>
      </section>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Recent transactions</h2>
          <Link href="/transactions" className="text-sm font-semibold text-[#355a3f]">
            View all
          </Link>
        </div>
        <div className="mt-5 divide-y divide-[#edf0ee]">
          {recent.length === 0 ? (
            <p className="py-4 text-sm text-[#60716a]">No movements in this period.</p>
          ) : (
            recent.map((txn) => (
              <div className="flex items-center justify-between py-4" key={txn.id}>
                <div>
                  <p className="font-semibold">{txn.merchant}</p>
                  <p className="mt-1 text-sm text-[#77857f]">
                    {tagsOf(txn).join(" · ")} · {txn.date}
                  </p>
                </div>
                <p className={`font-semibold ${txn.amount > 0 ? "text-[#257155]" : ""}`}>{formatSignedAud(txn.amount)}</p>
              </div>
            ))
          )}
        </div>
      </article>
    </>
  );
}
