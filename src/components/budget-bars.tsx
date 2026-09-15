import { ProgressBar } from "@/components/progress-bar";
import { formatAud } from "@/lib/format";
import type { BudgetRow } from "@/lib/money-flow/dashboard";

export function BudgetBars({ rows, daysLeft }: { rows: BudgetRow[]; daysLeft: number | null }) {
  return (
    <article className="card p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15.5px] font-bold">Budgets</h3>
        <span className="text-[12.5px] tabular-nums text-muted">
          {daysLeft === null ? "vs last period" : `${daysLeft} days left`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Spend by category will land here once a period has money out.</p>
      ) : (
        <div className="mt-4 grid gap-4">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="font-semibold">{row.label}</span>
                <span className="tabular-nums text-muted">
                  {row.target > 0
                    ? `${formatAud(row.spent)} / ${formatAud(row.target)}`
                    : formatAud(row.spent)}
                </span>
              </div>
              <ProgressBar value={row.percent} tone={row.over > 0 ? "over" : "default"} />
              {row.over > 0 ? (
                <p className="mt-1.5 text-xs font-semibold text-primary-strong">{formatAud(row.over)} over</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
