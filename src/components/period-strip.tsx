import { formatAud } from "@/lib/format";

/**
 * Spec 10 dashboard strip. Income and Spending stay interpretive.
 * The third tile is Account balance (Σ current account balances), not
 * parked Net Money(P) = Income − Spending + Refund credits.
 */
export function PeriodStrip({
  income,
  spending,
  accountBalance,
}: {
  income: number;
  spending: number;
  accountBalance: number | null;
}) {
  return (
    <article className="card flex flex-col gap-4 p-4 sm:flex-row">
      <PeriodCell label="Income" value={formatAud(income)} tone="positive" />
      <PeriodCell label="Spending" value={formatAud(spending)} tone="ink" />
      <PeriodCell
        label="Account balance"
        value={accountBalance == null ? "—" : formatAud(accountBalance)}
        tone={accountBalance != null && accountBalance > 0 ? "positive" : "ink"}
      />
    </article>
  );
}

function PeriodCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "ink";
}) {
  const accent = label !== "Spending";
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--radius-inner)] border border-line p-3 ${
        accent ? "bg-accent-surface" : "bg-surface"
      }`}
    >
      <p className="text-[12.5px] font-semibold text-muted">{label}</p>
      <p
        className={`text-[22px] font-bold tracking-tight tabular-nums ${
          tone === "positive" ? "text-positive" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
