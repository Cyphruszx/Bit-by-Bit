import type { Metadata } from "next";
import Link from "next/link";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { budgets, goals, periodLabel, snapshot, transactions } from "@/lib/demo-data";
import { formatAud, formatSignedAud } from "@/lib/format";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function Dashboard() {
  const recent = transactions.slice(0, 4);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your financial snapshot</h1>
      <p className="mt-2 text-[#60716a]">
        Placeholder data only — connected accounts and uploads come in later checkpoints.
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total income" value={formatAud(snapshot.income)} detail="This month" positive />
        <SummaryCard label="Total spending" value={formatAud(snapshot.spending)} detail="This month" />
        <SummaryCard label="Net cash flow" value={formatAud(snapshot.net)} detail="Income minus spending" positive />
      </section>
      <section className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Savings goals</h2>
            <Link href="/goals" className="text-sm font-semibold text-[#355a3f]">
              View all
            </Link>
          </div>
          <div className="mt-5 space-y-5">
            {goals.map((goal) => {
              const percent = Math.round((goal.saved / goal.target) * 100);
              return (
                <div key={goal.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{goal.name}</span>
                    <span className="text-[#60716a]">
                      {formatAud(goal.saved)} / {formatAud(goal.target)}
                    </span>
                  </div>
                  <ProgressBar value={percent} />
                </div>
              );
            })}
          </div>
        </article>
        <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
          <h2 className="text-lg font-bold">Spending vs budgets</h2>
          <div className="mt-5 space-y-5">
            {budgets.map((budget) => {
              const percent = Math.round((budget.spent / budget.limit) * 100);
              return (
                <div key={budget.name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{budget.name}</span>
                    <span className="text-[#60716a]">{formatAud(budget.spent)}</span>
                  </div>
                  <ProgressBar value={percent} />
                </div>
              );
            })}
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
          {recent.map((txn) => (
            <div className="flex items-center justify-between py-4" key={txn.id}>
              <div>
                <p className="font-semibold">{txn.merchant}</p>
                <p className="mt-1 text-sm text-[#77857f]">
                  {txn.category} · {txn.date}
                </p>
              </div>
              <p className={`font-semibold ${txn.amount > 0 ? "text-[#257155]" : ""}`}>
                {formatSignedAud(txn.amount)}
              </p>
            </div>
          ))}
        </div>
      </article>
    </>
  );
}
