import Link from "next/link";
import { formatAud } from "@/lib/format";
import type { SavingsPot } from "@/lib/money-flow/savings";

const RING = 2 * Math.PI * 18;

export function SavingsRings({ pots }: { pots: SavingsPot[] }) {
  return (
    <article className="card p-[22px]">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[15.5px] font-bold">Savings pots</h3>
        <Link href="/savings" className="text-[12.5px] font-semibold text-positive">
          View all
        </Link>
      </div>
      {pots.length === 0 ? (
        <p className="text-sm text-muted">
          Add a pot on{" "}
          <Link href="/savings" className="font-semibold text-ink-soft">
            Savings
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-3.5">
          {pots.slice(0, 3).map((pot, index) => {
            const percent = pot.target > 0 ? Math.round((pot.saved / pot.target) * 100) : 0;
            const dash = `${Math.min(RING, (percent / 100) * RING)} ${RING}`;
            return (
              <div key={pot.id} className="flex items-center gap-3.5">
                <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0" aria-hidden>
                  <circle cx="22" cy="22" r="18" fill="none" stroke="var(--color-axis)" strokeWidth="5" />
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke={`var(--color-chart-${(index % 4) + 2})`}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={dash}
                    transform="rotate(-90 22 22)"
                  />
                  <text x="22" y="26" textAnchor="middle" className="fill-ink text-[11px] font-bold">
                    {percent}%
                  </text>
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{pot.name}</p>
                  <p className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                    {formatAud(pot.saved)} of {formatAud(pot.target)}
                    {pot.monthlyContribution > 0 ? ` · ${formatAud(pot.monthlyContribution)}/mo` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
