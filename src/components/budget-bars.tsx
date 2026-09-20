import { formatAud } from "@/lib/format";
import { stackedBarPercents, spendFillToken, type BudgetRow } from "@/lib/money-flow/dashboard";

export function BudgetBars({ rows, daysLeft }: { rows: BudgetRow[]; daysLeft: number | null }) {
  return (
    <article className="card flex flex-col gap-5 px-8 py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="shrink-0 text-[15.5px] font-bold">Spending & budgets</h3>
        <div className="flex items-center gap-3">
          <LegendSwatch fill="bg-primary" label="Spend" />
          <LegendSwatch fill="bg-muted" label="Budget" />
        </div>
        {daysLeft !== null ? (
          <p className="shrink-0 text-right text-[12.5px] text-muted">{daysLeft} days left</p>
        ) : (
          <span className="shrink-0" />
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Spend by category will land here once a period has money out.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {rows.map((row, index) => (
            <SpendBudgetRow key={row.key} row={row} fill={spendFillToken(index)} />
          ))}
        </div>
      )}
    </article>
  );
}

function SpendBudgetRow({ row, fill }: { row: BudgetRow; fill: string }) {
  const bars = stackedBarPercents(row.spent, row.target);
  const over = row.over > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex w-full items-center gap-4">
        <p className="w-[110px] shrink-0 text-sm font-semibold">{row.label}</p>
        <p className="w-20 shrink-0 text-right text-[13px] font-semibold tabular-nums">{formatAud(row.spent)}</p>
        <div className="flex h-2 min-w-0 flex-1 items-center overflow-hidden rounded-[var(--radius-inner)] bg-accent-surface">
          <div
            className={`h-full rounded-[var(--radius-inner)] ${fill}`}
            style={{ width: `${bars.spend}%` }}
          />
        </div>
        {over ? (
          <p className="w-20 shrink-0 text-right text-xs font-semibold text-primary-strong">
            {formatAud(row.over)} over
          </p>
        ) : (
          <span className="block w-20 shrink-0" />
        )}
      </div>
      <div className="flex w-full items-center gap-4">
        <span className="block w-[110px] shrink-0" />
        {row.target > 0 ? (
          <p className="w-20 shrink-0 text-right text-[13px] font-semibold tabular-nums text-muted">
            {formatAud(row.target)}
          </p>
        ) : (
          <p className="w-20 shrink-0 text-right text-[11.5px] font-medium text-muted">No budget</p>
        )}
        <div className="flex h-2 min-w-0 flex-1 items-center overflow-hidden rounded-[var(--radius-inner)] bg-surface-subtle">
          <div
            className="h-full rounded-[var(--radius-inner)] bg-muted"
            style={{ width: `${bars.budget}%` }}
          />
        </div>
        <span className="block w-20 shrink-0" />
      </div>
    </div>
  );
}

function LegendSwatch({ fill, label }: { fill: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-2 shrink-0 rounded-[var(--radius-mark)] ${fill}`} />
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}
