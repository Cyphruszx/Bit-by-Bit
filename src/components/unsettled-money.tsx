"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { accountLabel } from "@/lib/money-flow/accounts";
import { unsettledGroups, type UnsettledGroup } from "@/lib/money-flow/income";
import { describeSpan } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { reasonLabel, reasonsFor, type VerdictReason } from "@/lib/money-flow/verdicts";

/**
 * The money the statements could not settle, put to the person one run at a time.
 *
 * A bank writing "Refund" on a year of Medicare billing, or "transfer" on a loan
 * drawdown, is not something a reader can see through — but a person can, in a second.
 * Asking by wording rather than by row is what makes it a second: 172 identical benefit
 * payments are one question.
 */
export function UnsettledMoney({ transactions }: { transactions: InterpretedTransaction[] }) {
  const { accountNames, institutionOverrides,
    payers, setVerdict } = useMoneyFlow();
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers }),
    [accountNames, institutionOverrides, payers],
  );
  const groups = useMemo(() => unsettledGroups(transactions, registry), [registry, transactions]);
  const [open, setOpen] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const total = groups.reduce((sum, group) => sum + group.amount, 0);

  return (
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-bold">Money in we can&apos;t place</h2>
        <p className="text-sm text-[#60716a]">
          <span className="tabular-nums">{formatAud(total)}</span> across {groups.length} kind
          {groups.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="mt-0.5 max-w-2xl text-xs text-[#60716a]">
        Counted as money in, because nothing in your statements says otherwise. Tell us what these
        really are and the totals follow. Answering one settles every movement worded like it.
      </p>
      <ul className="mt-3 divide-y divide-[#edf0ee]">
        {groups.map((group) => (
          <UnsettledRow
            key={group.key}
            group={group}
            open={open === group.key}
            onOpen={() => setOpen(open === group.key ? null : group.key)}
            onChoose={(reason) => {
              setVerdict(group.example, reason, "like");
              setOpen(null);
            }}
          />
        ))}
      </ul>
    </article>
  );
}

function UnsettledRow({
  group,
  open,
  onOpen,
  onChoose,
}: {
  group: UnsettledGroup;
  open: boolean;
  onOpen: () => void;
  onChoose: (reason: VerdictReason) => void;
}) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{group.label}</p>
          <p className="mt-0.5 text-xs text-[#60716a]">
            {describeSpan(group.from, group.to)} · {accountLabel(group.account)} · {group.count} movement
            {group.count === 1 ? "" : "s"} ·{" "}
            {group.kind === "returned" ? "your bank calls this a refund" : "your bank calls this a transfer"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold tabular-nums text-[#257155]">{formatAud(group.amount)}</p>
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            className="rounded-full border border-[#dce4df] px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
          >
            {open ? "Cancel" : "What is it?"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {reasonsFor(group.example.amount).map((choice) => (
            <button
              key={choice.reason}
              type="button"
              onClick={() => onChoose(choice.reason)}
              className="rounded-full border border-[#c3d2ca] bg-[#f4f7f5] px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
            >
              {choice.label}
              {group.count > 1 ? ` · all ${group.count}` : ""}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** What a person has already settled, so a wrong answer can be taken back. */
export function SettledMoney({ transactions }: { transactions: InterpretedTransaction[] }) {
  const { setVerdict } = useMoneyFlow();
  const settled = useMemo(() => transactions.filter((txn) => txn.verdict), [transactions]);

  if (settled.length === 0) return null;

  const groups = new Map<string, { rows: InterpretedTransaction[]; because: VerdictReason }>();
  for (const txn of settled) {
    const label = txn.description?.trim() || txn.merchant;
    // The account belongs in the key: one payer paying into two accounts is two verdicts,
    // and a single Undo can only ever clear the one it was given.
    const key = `${label}|${txn.verdict?.because}|${txn.accountId ?? txn.sourceFile}`;
    const held = groups.get(key);
    groups.set(key, {
      rows: [...(held?.rows ?? []), txn],
      because: txn.verdict?.because ?? "earned",
    });
  }

  return (
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <h2 className="text-base font-bold">What you&apos;ve told us</h2>
      <ul className="mt-3 divide-y divide-[#edf0ee]">
        {[...groups].map(([key, held]) => {
          const label = held.rows[0].description?.trim() || held.rows[0].merchant;
          const amount = held.rows.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
          return (
            <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{label}</p>
                <p className="mt-0.5 text-xs text-[#60716a]">
                  {reasonLabel(held.because)} · {held.rows.length} movement
                  {held.rows.length === 1 ? "" : "s"} · <span className="tabular-nums">{formatAud(amount)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVerdict(held.rows[0], null, "like")}
                className="rounded-full border border-[#dce4df] px-3 py-1.5 text-sm font-semibold text-[#355a3f]"
              >
                Undo
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
