export function SummaryCard({
  label,
  value,
  detail,
  positive = false,
  compact = false,
  highlight = false,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
  compact?: boolean;
  highlight?: boolean;
}) {
  return (
    <article className={`${highlight ? "card-highlight" : "card"} ${compact ? "px-3.5 py-2.5" : "p-5"}`}>
      <p className={`text-sm ${highlight ? "text-on-dark-muted" : "text-muted"}`}>{label}</p>
      <p
        className={`${compact ? "mt-0.5 text-xl" : "mt-2 text-[27px]"} break-words font-bold tracking-tight tabular-nums ${
          highlight ? "text-on-dark" : positive ? "text-positive" : ""
        }`}
      >
        {value}
      </p>
      <p className={`${compact ? "mt-0.5 text-xs" : "mt-1 text-[12.5px]"} ${highlight ? "text-on-dark-muted" : "text-muted"}`}>
        {detail}
      </p>
    </article>
  );
}
