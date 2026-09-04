"use client";

import { useMemo } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { accountLabel } from "@/lib/money-flow/accounts";
import { describeSpan } from "@/lib/money-flow/parse-values";
import { incomeRhythms, type Rhythm, type RhythmBreak } from "@/lib/money-flow/rhythm";

/**
 * What each stream of money in is worth a week, and where it stopped.
 *
 * A person knows what they earn, so when the app disagrees the useful thing is not another
 * total but a rate: $5,409 means nothing, two weeks of billing means everything. The rate
 * is measured over the stretches a stream was running, so a month off does not make a
 * practice look smaller than it is.
 */
export function IncomeRhythm() {
  const { accountNames, allTransactions, institutionOverrides, payers } = useMoneyFlow();
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers }),
    [accountNames, institutionOverrides, payers],
  );
  const rhythms = useMemo(
    () => incomeRhythms(allTransactions, { registry }),
    [allTransactions, registry],
  );

  if (rhythms.length === 0) return null;

  const maybeMissing = rhythms.flatMap((rhythm) =>
    rhythm.breaks.filter((found) => found.reading === "may-be-missing"),
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold">What comes in, and how often</h2>
        {maybeMissing.length > 0 ? (
          <p className="text-sm font-semibold text-[#8a5a2b]">
            {maybeMissing.length} gap{maybeMissing.length === 1 ? "" : "s"} may be a missing statement
          </p>
        ) : null}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-[#60716a]">
        Each stream&apos;s rate, measured over the weeks it was actually running. Use it to check a
        total against what you know you earn: a difference is easier to judge in weeks than in
        dollars.
      </p>
      <div className="mt-4 space-y-3">
        {rhythms.map((rhythm) => (
          <RhythmCard key={rhythm.key} rhythm={rhythm} />
        ))}
      </div>
    </section>
  );
}

function RhythmCard({ rhythm }: { rhythm: Rhythm }) {
  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold">{rhythm.label}</h3>
          <p className="mt-0.5 text-sm text-[#60716a]">
            {accountLabel(rhythm.account)} · {rhythm.count} payments · {describeSpan(rhythm.first, rhythm.last)}
          </p>
        </div>
        <p className="text-sm text-[#60716a]">
          <span className="font-semibold tabular-nums text-[#257155]">{formatAud(rhythm.perWeek)}</span> a
          week · <span className="tabular-nums">{formatAud(rhythm.perFortnight)}</span> a fortnight
        </p>
      </div>
      <p className="mt-2 text-sm text-[#60716a]">
        Arrives {everyLabel(rhythm.everyDays)}, and has been running {rhythm.weeksRunning} week
        {rhythm.weeksRunning === 1 ? "" : "s"} of the {describeSpan(rhythm.first, rhythm.last)} it spans.
        Total <span className="tabular-nums">{formatAud(rhythm.total)}</span>.
      </p>
      {rhythm.breaks.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-[#edf0ee] pt-3">
          {rhythm.breaks.map((found) => (
            <BreakRow key={`${found.after}-${found.until}`} found={found} />
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function BreakRow({ found }: { found: RhythmBreak }) {
  const missing = found.reading === "may-be-missing";
  return (
    <li className="text-sm">
      <p className={missing ? "font-semibold text-[#8a5a2b]" : "text-[#52625c]"}>
        Nothing for {found.days} days, {describeSpan(found.after, found.until)} — about{" "}
        <span className="tabular-nums">{formatAud(found.worth)}</span> at this rate.
      </p>
      <p className="mt-0.5 text-[#60716a]">
        {missing
          ? "The whole account went quiet too, so a statement covering this may be missing."
          : "The account kept moving through it, so this looks like a pause rather than a gap in your documents."}
      </p>
    </li>
  );
}

/** "every day" reads better than "every 1 days", and a week better than 7. */
function everyLabel(days: number): string {
  if (days <= 1) return "most days";
  if (days === 7) return "weekly";
  if (days === 14) return "fortnightly";
  if (days >= 28 && days <= 31) return "monthly";
  return `about every ${days} days`;
}
