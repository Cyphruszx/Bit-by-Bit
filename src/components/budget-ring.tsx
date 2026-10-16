import { formatAud } from "@/lib/format";
import { ringRead } from "@/lib/money-flow/budget-plan";

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 124px ring. Blues only. The left or over figure sits above it. */
export function BudgetRing({ planned, spent }: { planned: number; spent: number }) {
  const read = ringRead(planned, spent);
  const figure = read.over ? `${formatAud(read.figure)} over` : `${formatAud(read.figure)} left`;
  const dash = read.fill * CIRCUMFERENCE;

  return (
    <div className="flex w-[124px] shrink-0 flex-col items-center gap-2">
      <p className="text-center text-sm font-semibold tabular-nums">{figure}</p>
      <svg viewBox="0 0 120 120" className="size-[124px]" role="img" aria-label={figure}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" className="stroke-chart-4" strokeWidth="12" />
        {read.fill > 0 ? (
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            className="stroke-primary"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            transform="rotate(-90 60 60)"
          />
        ) : null}
      </svg>
    </div>
  );
}
