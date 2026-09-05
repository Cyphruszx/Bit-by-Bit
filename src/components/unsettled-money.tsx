"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import { accountLabel } from "@/lib/money-flow/accounts";
import { displayName } from "@/lib/money-flow/display-name";
import { unsettledGroups, type UnsettledGroup } from "@/lib/money-flow/income";
import { describeSpan } from "@/lib/money-flow/parse-values";
import { categoryLabel } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";
import { reasonLabel, reasonsFor, type VerdictReason } from "@/lib/money-flow/verdicts";

/**
 * Credits still sitting in money in that the ledger could not file.
 *
 * Needs a category is for shops. This list is only refunds and transfers with no
 * category and no matching payment — the bank's label is a hint, not the answer.
 * Medicare, ATO rebates and a lender's drawdown are already typed, so they are not here.
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
          <span className="tabular-nums">{formatAud(total)}</span> across {groups.length}{" "}
          {groups.length === 1 ? "question" : "questions"}
        </p>
      </div>
      <p className="mt-0.5 max-w-2xl text-xs text-[#60716a]">
        Still in money in, still without a category, and the bank called them a refund or a
        transfer. Wages, Medicare and anything the ledger already filed are not here. Answering
        one settles every movement worded like it.
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
            {group.count === 1 ? "" : "s"} · {categoryLabel(group.example.categoryKey)} ·{" "}
            {group.kind === "returned"
              ? bankClaim(group.example, "refund")
              : bankClaim(group.example, "transfer")}
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
    const label = displayName(txn);
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
          const label = displayName(held.rows[0]);
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

function bankClaim(txn: InterpretedTransaction, fallback: "refund" | "transfer"): string {
  const written = txn.bank?.category?.trim();
  return written ? `statement: ${written}` : `the bank called this a ${fallback}`;
}
