import type { Metadata } from "next";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { budgets, goals } from "@/lib/demo-data";
import { formatAud } from "@/lib/format";

export const metadata: Metadata = {
  title: "Goals",
};

export default function GoalsPage() {
  const saved = goals.reduce((sum, goal) => sum + goal.saved, 0);
  const target = goals.reduce((sum, goal) => sum + goal.target, 0);
  const monthly = goals.reduce((sum, goal) => sum + goal.monthlyContribution, 0);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Bit by bit</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Your finance goals</h1>
      <p className="mt-2 text-[#60716a]">Track savings targets and monthly budgets in one place.</p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Saved toward goals" value={formatAud(saved)} detail="Across three active goals" positive />
        <SummaryCard label="Combined target" value={formatAud(target)} detail="Emergency, travel, and home" />
        <SummaryCard label="Monthly contributions" value={formatAud(monthly)} detail="Planned this month" />
      </section>
      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {goals.map((goal) => {
          const remaining = goal.target - goal.saved;
          const percent = Math.round((goal.saved / goal.target) * 100);
          const monthsLeft = Math.ceil(remaining / goal.monthlyContribution);
          return (
            <article key={goal.id} className="rounded-2xl border border-[#dce4df] bg-white p-6">
              <h2 className="text-lg font-bold">{goal.name}</h2>
              <p className="mt-1 text-sm text-[#60716a]">{goal.detail}</p>
              <p className="mt-5 text-2xl font-bold">{formatAud(goal.saved)}</p>
              <p className="mt-1 text-sm text-[#77857f]">of {formatAud(goal.target)}</p>
              <ProgressBar value={percent} />
              <p className="mt-4 text-sm text-[#52625c]">
                {formatAud(goal.monthlyContribution)} each month · about {monthsLeft} months to go
              </p>
            </article>
          );
        })}
      </section>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Monthly budgets</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {budgets.map((budget) => {
            const remaining = budget.limit - budget.spent;
            const percent = Math.round((budget.spent / budget.limit) * 100);
            return (
              <div key={budget.name}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{budget.name}</span>
                  <span className="text-[#60716a]">
                    {formatAud(budget.spent)} / {formatAud(budget.limit)}
                  </span>
                </div>
                <ProgressBar value={percent} />
                <p className="mt-1 text-sm text-[#77857f]">{formatAud(remaining)} left this month</p>
              </div>
            );
          })}
        </div>
      </article>
    </>
  );
}
