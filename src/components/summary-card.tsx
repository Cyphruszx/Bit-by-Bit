export function SummaryCard({
  label,
  value,
  detail,
  positive = false,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-5">
      <p className="text-sm text-[#60716a]">{label}</p>
      <p className={`mt-2 break-words text-2xl font-bold tabular-nums ${positive ? "text-[#257155]" : ""}`}>{value}</p>
      <p className="mt-1 text-sm text-[#77857f]">{detail}</p>
    </article>
  );
}
