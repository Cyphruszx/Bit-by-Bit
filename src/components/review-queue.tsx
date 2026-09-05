"use client";

import { useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud, formatCount } from "@/lib/format";
import { reviewGroups, reviewProgress } from "@/lib/money-flow/review";
import { categoryLabel, CATEGORY_KEYS, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/** Enough to see the shape of the work without turning the page into a spreadsheet. */
const SHOWN = 6;

/**
 * The movements nothing could place, asked one merchant at a time.
 *
 * A year of statements arrives at once, and the honest thing to show is not four hundred
 * rows of "Not sorted yet" — it is how much is already done, and the shortest path through
 * what is left. Answering the top question here re-files every movement of that merchant
 * and every one that arrives later, so the list is much shorter than the row count.
 */
export function ReviewQueue({ transactions }: { transactions: InterpretedTransaction[] }) {
  const { setMerchantCategory } = useMoneyFlow();
  const [open, setOpen] = useState(false);
  const groups = reviewGroups(transactions);
  const progress = reviewProgress(transactions);

  if (groups.length === 0) {
    if (progress.total === 0) return null;
    return (
      <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
        <h2 className="text-base font-bold">Everything is sorted</h2>
        <p className="mt-0.5 text-xs text-[#60716a]">
          All {formatCount(progress.total)} movements in this period have a category.
        </p>
      </article>
    );
  }

  const shown = open ? groups : groups.slice(0, SHOWN);

  return (
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Needs a category</h2>
          <p className="mt-0.5 text-xs text-[#60716a]">
            {groups.length === 1
              ? "One merchant to place."
              : `${formatCount(groups.length)} merchants to place, biggest first.`}{" "}
            Answer one and every movement of that merchant follows, now and later.
          </p>
        </div>
        <p className="shrink-0 text-xs font-semibold text-[#355a3f]">
          {progress.percent}% sorted
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="How much of this period has a category"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf0ee]"
      >
        <div className="h-full rounded-full bg-[#173b31]" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-[#77857f]">
        {formatCount(progress.sorted)} of {formatCount(progress.total)} placed ·{" "}
        {formatAud(progress.unsorted)} still to account for
      </p>

      <ul className="mt-3 divide-y divide-[#edf0ee]">
        {shown.map((group) => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={group.merchant}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{group.merchant}</p>
              <p className="text-xs text-[#77857f]">
                {group.count === 1 ? "One movement" : `${formatCount(group.count)} movements`} ·{" "}
                {formatAud(Math.abs(group.amount))} {group.amount > 0 ? "in" : "out"}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-1.5">
              <span className="sr-only">Category for {group.merchant}</span>
              <select
                value={UNCATEGORISED}
                onChange={(event) => {
                  if (event.target.value !== UNCATEGORISED) {
                    setMerchantCategory(group.merchant, event.target.value);
                  }
                }}
                className="rounded-full border border-[#dce4df] bg-white px-2.5 py-1 text-xs outline-none focus:border-[#173b31]"
              >
                <option value={UNCATEGORISED}>Choose a category</option>
                {CATEGORY_KEYS.filter((key) => key !== UNCATEGORISED).map((key) => (
                  <option key={key} value={key}>
                    {key.includes(".") ? `  ${categoryLabel(key)}` : categoryLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>

      {groups.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-2 rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f]"
        >
          {open ? "Show fewer" : `Show all ${formatCount(groups.length)}`}
        </button>
      ) : null}
    </article>
  );
}
