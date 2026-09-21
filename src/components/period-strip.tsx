import { formatAud, formatSignedAud } from "@/lib/format";

export function PeriodStrip({
  income,
  spending,
  net,
}: {
  income: number;
  spending: number;
  net: number;
}) {
  return (
    <article className="card flex flex-col gap-4 p-4 sm:flex-row">
      <PeriodCell label="Income" value={formatAud(income)} tone="positive" />
      <PeriodCell label="Spending" value={formatAud(spending)} tone="ink" />
      <PeriodCell
        label="Net"
        value={formatSignedAud(net)}
        tone={net > 0 ? "positive" : "ink"}
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
