"use client";

import { useMemo } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { payerGroups, payerSuggestions } from "@/lib/money-flow/payers";

/**
 * Wordings that may be one payer, put to the person rather than joined quietly.
 *
 * A bank writes a payer's name more than one way — Medicare pays the same practice with
 * the name at the end, in the middle, and not at all — and read literally that is three
 * payers with a third of the rate each. Which of them are really one is a judgement, and a
 * wrong merge fuses two payers' totals somewhere nobody will look again.
 */
export function PayerSuggestions() {
  const { accountNames, allTransactions, institutionOverrides, mergePayers, payers } = useMoneyFlow();
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers }),
    [accountNames, institutionOverrides, payers],
  );
  const suggestions = useMemo(
    () => payerSuggestions(allTransactions, registry),
    [allTransactions, registry],
  );
  const joined = useMemo(() => {
    const groups = new Map(payerGroups(allTransactions, registry).map((group) => [group.key, group]));
    return Object.entries(payers).map(([from, into]) => ({
      from,
      into,
      label: groups.get(into)?.label ?? into,
      dropped: groups.get(from)?.label ?? from,
      count: groups.get(from)?.count ?? 0,
      total: groups.get(from)?.total ?? 0,
    }));
  }, [allTransactions, payers, registry]);

  if (suggestions.length === 0 && joined.length === 0) return null;

  return (
    <section className="mt-8 space-y-4">
      {suggestions.length > 0 ? (
        <article className="rounded-2xl border border-attention-line bg-attention-surface p-6">
          <h2 className="text-lg font-bold">These might be the same payer</h2>
          <p className="mt-1 max-w-2xl text-sm text-attention-ink">
            Your bank does not always write a payer&apos;s name the same way. Until you say, each
            wording is counted as its own stream, which splits a rate and asks you the same question
            twice.
          </p>
          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion) => (
              <div
                key={`${suggestion.keep}-${suggestion.merge}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-attention-ink">
                    {suggestion.mergeLabel}
                  </p>
                  <p className="mt-0.5 text-sm text-attention-ink">
                    {suggestion.count} movement{suggestion.count === 1 ? "" : "s"} ·{" "}
                    <span className="tabular-nums">{formatAud(suggestion.amount)}</span> · {suggestion.reason}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-attention-ink">
                    Would join <span className="font-semibold">{suggestion.keepLabel}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => mergePayers(suggestion.merge, suggestion.keep)}
                  className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary"
                >
                  Same payer
                </button>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {joined.length > 0 ? (
        <article className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-base font-bold">Payers you&apos;ve joined</h2>
          <ul className="mt-3 divide-y divide-surface-subtle">
            {joined.map((merge) => (
              <li key={merge.from} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <p className="min-w-0 truncate text-sm text-muted">
                  <span className="font-semibold">{merge.dropped}</span> counted as{" "}
                  <span className="font-semibold">{merge.label}</span>
                </p>
                <button
                  type="button"
                  onClick={() => mergePayers(merge.from, null)}
                  className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft"
                >
                  Separate
                </button>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
