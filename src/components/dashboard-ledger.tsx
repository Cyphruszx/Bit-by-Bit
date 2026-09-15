import Link from "next/link";
import { formatAud, formatSignedAud } from "@/lib/format";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import type { LedgerPreviewRow } from "@/lib/money-flow/dashboard";

export function DashboardLedger({
  rows,
  periodLabel,
  count,
}: {
  rows: LedgerPreviewRow[];
  periodLabel: string;
  count: number;
}) {
  return (
    <article className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 px-[22px] pt-5 pb-3.5">
        <div>
          <h3 className="text-[15.5px] font-bold">Ledger</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {count} movement{count === 1 ? "" : "s"} in {periodLabel}
          </p>
        </div>
        <Link href="/transactions" className="text-[12.5px] font-semibold text-positive">
          View all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-[22px] pb-5 text-sm text-muted">No movements in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-subtle text-left text-muted">
                <th className="border-y border-line px-[22px] py-2 text-[10.5px] font-bold tracking-[0.1em] uppercase">Date</th>
                <th className="border-y border-line px-3 py-2 text-[10.5px] font-bold tracking-[0.1em] uppercase">Merchant</th>
                <th className="border-y border-line px-3 py-2 text-[10.5px] font-bold tracking-[0.1em] uppercase">Category</th>
                <th className="border-y border-line px-3 py-2 text-[10.5px] font-bold tracking-[0.1em] uppercase">Account</th>
                <th className="border-y border-line px-3 py-2 text-right text-[10.5px] font-bold tracking-[0.1em] uppercase">Amount</th>
                <th className="border-y border-line px-[22px] py-2 text-right text-[10.5px] font-bold tracking-[0.1em] uppercase">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className={index % 2 === 1 ? "bg-surface-faint" : ""}>
                  <td className="border-b border-line-dashed px-[22px] py-3 tabular-nums text-muted">
                    {formatDisplayDate(row.dateIso)}
                  </td>
                  <td className="border-b border-line-dashed px-3 py-3 font-semibold">{row.merchant}</td>
                  <td className="border-b border-line-dashed px-3 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                        row.needsCategory
                          ? "border border-line bg-surface-subtle text-muted"
                          : "bg-accent-surface text-primary-strong"
                      }`}
                    >
                      {row.needsCategory ? "Needs a category" : row.categoryLabel}
                    </span>
                  </td>
                  <td className="border-b border-line-dashed px-3 py-3 text-muted">{row.account}</td>
                  <td
                    className={`border-b border-line-dashed px-3 py-3 text-right font-semibold tabular-nums ${
                      row.amount > 0 ? "text-positive" : ""
                    }`}
                  >
                    {formatSignedAud(row.amount)}
                  </td>
                  <td className="border-b border-line-dashed px-[22px] py-3 text-right tabular-nums text-muted">
                    {formatAud(row.position)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
