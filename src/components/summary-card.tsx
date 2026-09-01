export function SummaryCard({
  label,
  value,
  detail,
  positive = false,
  compact = false,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
  compact?: boolean;
}) {
  return (
    <article className={`rounded-2xl border border-[#dce4df] bg-white ${compact ? "px-3.5 py-2.5" : "p-5"}`}>
      <p className="text-sm text-[#60716a]">{label}</p>
      <p className={`${compact ? "mt-0.5 text-xl" : "mt-2 text-2xl"} break-words font-bold tabular-nums ${positive ? "text-[#257155]" : ""}`}>
        {value}
      </p>
      <p className={`${compact ? "mt-0.5 text-xs" : "mt-1 text-sm"} text-[#77857f]`}>{detail}</p>
    </article>
  );
}
