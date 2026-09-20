import Link from "next/link";
import { formatAud } from "@/lib/format";
import type { SavingsPot } from "@/lib/money-flow/savings";

const RING = 2 * Math.PI * 30;
const RING_COLORS = ["var(--color-primary)", "var(--color-secondary)", "var(--color-chart-3)", "var(--color-chart-4)"];

export function SavingsRings({ pots }: { pots: SavingsPot[] }) {
  return (
    <article className="card p-[22px]">
      <h3 className="text-[15.5px] font-bold">Savings pots</h3>
      {pots.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Add a pot on{" "}
          <Link href="/savings" className="font-semibold text-ink-soft">
            Savings
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-4">
          {pots.slice(0, 4).map((pot, index) => {
            const percent = pot.target > 0 ? Math.round((pot.saved / pot.target) * 100) : 0;
            const dash = `${Math.min(RING, (percent / 100) * RING)} ${RING}`;
            return (
              <div key={pot.id} className="flex flex-1 flex-col items-center gap-2">
                <svg viewBox="0 0 72 72" className="size-[72px] shrink-0" aria-hidden>
                  <circle cx="36" cy="36" r="30" fill="none" stroke="var(--color-axis)" strokeWidth="6" />
                  <circle
                    cx="36"
                    cy="36"
                    r="30"
                    fill="none"
                    stroke={RING_COLORS[index % RING_COLORS.length]}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={dash}
                    transform="rotate(-90 36 36)"
                  />
                  <text x="36" y="40" textAnchor="middle" className="fill-ink text-xs font-bold">
                    {percent}%
                  </text>
                </svg>
                <p className="text-[12.5px] font-semibold">{pot.name}</p>
                <p className="text-[11.5px] tabular-nums text-muted">{formatAud(pot.saved)}</p>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
