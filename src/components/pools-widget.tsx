"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/components/session-store";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud, formatSignedAud } from "@/lib/format";
import {
  accountKindOf,
  isCashAccountKind,
  type AccountKind,
} from "@/lib/money-flow/account-identity";
import { accountsFrom } from "@/lib/money-flow/accounts";
import {
  CASH_IN_POOL_LABEL,
  NOT_ACTUAL_SAVINGS,
  POOL_OVERLAP_DISCLOSE,
  POOLS_TITLE,
  cashInPool,
  livePools,
  memberSignedBalance,
  membersOf,
  poolBookOf,
  type AccountPool,
} from "@/lib/money-flow/pools";

/**
 * Spec 11 Pools widget. Named groups + undoable membership. Display only —
 * nothing here writes the ledger or Spec 10 tiles.
 */
export function PoolsWidget() {
  const {
    accountMeta,
    accountNames,
    accountPoolMembers,
    accountPools,
    addPoolMember,
    allTransactions,
    archivePool,
    createPool,
    featureOn,
    institutionOverrides,
    mergedInto,
    payers,
    removePoolMember,
    renamePool,
  } = useMoneyFlow();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const book = useMemo(
    () => poolBookOf(accountPools, accountPoolMembers),
    [accountPoolMembers, accountPools],
  );
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const accounts = useMemo(() => accountsFrom(allTransactions, registry), [allTransactions, registry]);
  const pools = livePools(book);

  if (!featureOn("POOLS")) return null;

  const add = () => {
    const result = createPool({
      userId: session?.userId ?? "guest",
      name: draftName,
      ...(draftNotes.trim() ? { notes: draftNotes } : {}),
    });
    if (!result.ok) {
      setError(result.reason);
      setWarning(null);
      return;
    }
    setDraftName("");
    setDraftNotes("");
    setError(null);
    setWarning(result.softWarning ?? null);
  };

  return (
    <article className="mt-8 rounded-2xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{POOLS_TITLE}</h2>
          <p className="mt-1 text-sm font-semibold text-muted">{NOT_ACTUAL_SAVINGS}</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{POOL_OVERLAP_DISCLOSE}</p>

      {pools.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No pools yet.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {pools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              bookMembers={membersOf(book, pool.id)}
              accounts={accounts}
              accountMeta={accountMeta}
              mergedInto={mergedInto}
              onRename={(name) => {
                const result = renamePool(pool.id, name);
                setError(result.ok ? null : result.reason);
              }}
              onArchive={() => {
                const result = archivePool(pool.id);
                setError(result.ok ? null : result.reason);
              }}
              onAdd={(accountId) => {
                const result = addPoolMember(pool.id, accountId);
                setError(result.ok ? null : result.reason);
              }}
              onRemove={(accountId) => {
                const result = removePoolMember(pool.id, accountId);
                setError(result.ok ? null : result.reason);
              }}
            />
          ))}
        </div>
      )}

      <form
        className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="font-semibold">Add pool</span>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Holiday, Bills, …"
            className="rounded-full border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Notes</span>
          <input
            value={draftNotes}
            onChange={(event) => setDraftNotes(event.target.value)}
            placeholder="Optional"
            className="rounded-full border border-line bg-white px-3 py-1.5 text-sm"
          />
        </label>
        <button type="submit" className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white">
          Add pool
        </button>
      </form>
      {warning ? <p className="mt-3 text-sm text-attention-ink">{warning}</p> : null}
      {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
    </article>
  );
}

function PoolCard({
  pool,
  bookMembers,
  accounts,
  accountMeta,
  mergedInto,
  onRename,
  onArchive,
  onAdd,
  onRemove,
}: {
  pool: AccountPool;
  bookMembers: { poolId: string; accountId: string; addedAt: string }[];
  accounts: ReturnType<typeof accountsFrom>;
  accountMeta: ReturnType<typeof useMoneyFlow>["accountMeta"];
  mergedInto: Record<string, string>;
  onRename: (name: string) => void;
  onArchive: () => void;
  onAdd: (accountId: string) => void;
  onRemove: (accountId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pool.name);
  const cash = cashInPool({ pools: [pool], members: bookMembers }, pool.id, accountMeta, mergedInto);
  const memberIds = new Set(bookMembers.map((member) => member.accountId));
  const candidates = accounts.filter((account) => !memberIds.has(account.id));
  const cashCandidates = candidates.filter((account) => isCashAccountKind(accountKindOf(account.id, accountMeta)));
  const debtCandidates = candidates.filter((account) => !isCashAccountKind(accountKindOf(account.id, accountMeta)));
  const missingHint = bookMembers.some((member) => memberSignedBalance(member.accountId, accountMeta, mergedInto).missing);

  return (
    <div className="rounded-xl border border-line px-4 py-4" style={pool.colour ? { borderColor: pool.colour } : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-full border border-line bg-white px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  onRename(name);
                  setEditing(false);
                }}
                className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          ) : (
            <h3 className="text-base font-bold">{pool.name}</h3>
          )}
          {pool.notes ? <p className="mt-1 text-sm text-muted">{pool.notes}</p> : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setName(pool.name);
              setEditing(true);
            }}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft"
          >
            Archive
          </button>
        </div>
      </div>

      <p className="mt-3 text-sm">
        <span className="font-semibold">{CASH_IN_POOL_LABEL}</span>{" "}
        <span className="tabular-nums">
          {cash.amount == null ? "—" : formatAud(cash.amount)}
        </span>
      </p>

      {bookMembers.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {bookMembers.map((member) => {
            const account = accounts.find((row) => row.id === member.accountId);
            const label = account?.label ?? member.accountId;
            const kind = accountKindOf(member.accountId, accountMeta);
            const signed = memberSignedBalance(member.accountId, accountMeta, mergedInto);
            return (
              <li key={member.accountId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {label}
                  <span className="ml-2 text-xs text-muted">{kindLabel(kind)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums font-semibold">{formatSignedAud(signed.amount)}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(member.accountId)}
                    className="text-xs font-semibold text-muted underline"
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No accounts in this pool yet.</p>
      )}

      {missingHint ? (
        <p className="mt-2 text-xs text-muted">Cleared balance not stored yet — showing $0.</p>
      ) : null}

      {candidates.length > 0 ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <span className="shrink-0">Assign</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onAdd(event.target.value);
            }}
            className="w-full rounded-full border border-line bg-white px-3 py-1.5 text-sm"
          >
            <option value="">An account…</option>
            {cashCandidates.length > 0 ? (
              <optgroup label="Cash">
                {cashCandidates.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {debtCandidates.length > 0 ? (
              <optgroup label="Credit / loan / mortgage">
                {debtCandidates.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function kindLabel(kind: AccountKind): string {
  if (kind === "CHECKING") return "Everyday";
  if (kind === "SAVINGS") return "Savings";
  if (kind === "CREDIT") return "Credit";
  if (kind === "LOAN") return "Loan";
  return "Mortgage";
}
