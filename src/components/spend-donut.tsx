import { formatAud } from "@/lib/format";
import type { SpendSlice } from "@/lib/money-flow/dashboard";

const CIRCUMFERENCE = 2 * Math.PI * 60;

export function SpendDonut({
  slices,
  total,
  caption,
}: {
  slices: SpendSlice[];
  total: number;
  caption: string;
}) {
  const rings = slices.map((slice, index) => {
    const length = (Math.abs(slice.share) / 100) * CIRCUMFERENCE;
    const offset = slices
      .slice(0, index)
      .reduce((sum, item) => sum + (Math.abs(item.share) / 100) * CIRCUMFERENCE + 2, 0);
    return { ...slice, length, offset };
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-[150px] w-[150px] shrink-0" role="img" aria-label="Spend by category">
        <g transform="rotate(-90 80 80)" fill="none" strokeWidth="22">
          {rings.map((slice) => (
            <circle
              key={slice.name}
              cx="80"
              cy="80"
              r="60"
              stroke={slice.color}
              strokeDasharray={`${slice.length} ${CIRCUMFERENCE}`}
              strokeDashoffset={-slice.offset}
            />
          ))}
        </g>
        <text x="80" y="76" textAnchor="middle" className="fill-ink text-[19px] font-bold">
          {formatAud(total).replace(/\.00$/, "")}
        </text>
        <text x="80" y="93" textAnchor="middle" className="fill-muted text-[10.5px]">
          out this month
        </text>
      </svg>
      <div className="grid min-w-0 gap-2 text-[12.5px]">
        {slices.map((slice) => (
          <span key={slice.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: slice.color }} />
            <span className="flex-1">{slice.label}</span>
            <b className="tabular-nums">{slice.share}%</b>
          </span>
        ))}
      </div>
      <span className="sr-only">{caption}</span>
    </div>
  );
}
