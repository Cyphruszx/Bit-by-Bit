"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IncomeRhythm } from "@/components/income-rhythm";
import { PayerSuggestions } from "@/components/payer-suggestions";
import { EmptyLedger } from "@/components/empty-ledger";
import { FeatureEnableOffer, OpenBankingAccountsControl } from "@/components/feature-enable-offer";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { PoolsWidget } from "@/components/pools-widget";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { mergeSuggestions } from "@/lib/money-flow/account-identity";
import { accountsByInstitution, suggestNameForKey, type AccountTotals } from "@/lib/money-flow/accounts";
import {
  institutionForStatement,
  knownInstitutions,
  UNKNOWN_INSTITUTION,
} from "@/lib/money-flow/institution";
import { livePools, poolBookOf, poolsForAccount, type PoolBook } from "@/lib/money-flow/pools";

export function AccountsView() {
  const {
    files,
    flow,
    hasUploads,
    allTransactions,
    institutionOverrides,
    payers,
    setStatementInstitution,
    accountNames,
    setAccountName,
    mergeAccount,
    mergedInto,
    accountPools,
    accountPoolMembers,
    featureOn,
  } = useMoneyFlow();

  const registry = { names: accountNames, institutions: institutionOverrides, payers, mergedInto };
  const groups = accountsByInstitution(allTransactions, registry);
  const accounts = groups.flatMap((group) => group.accounts);
  const suggestions = mergeSuggestions(accounts.flatMap((account) => account.keys));
  const poolBook = useMemo(
    () => poolBookOf(accountPools, accountPoolMembers),
    [accountPoolMembers, accountPools],
  );
  const poolsOn = featureOn("POOLS");
  const pools = poolsOn ? livePools(poolBook) : [];
  const [poolFilter, setPoolFilter] = useState<string>("all");

  const [mergeError, setMergeError] = useState<string | null>(null);

  const nameOf = (account: AccountTotals) =>
    accountNames[account.keys[0]]?.trim() ||
    suggestNameForKey(account.keys[0], account.transactions[0]?.sourceFile ?? account.keys[0]);

  const rename = (account: AccountTotals, name: string) => {
    for (const key of account.keys) setAccountName(key, name);
  };

  const merge = (account: AccountTotals, into: AccountTotals) => {
    const survivor = into.keys[0];
    const source = account.keys.find((key) => key !== survivor) ?? account.keys[0];
    if (!survivor || !source) return;
    const result = mergeAccount(source, survivor);
    setMergeError(result.ok ? null : result.reason);
  };

  const accountFor = (key: string) => accounts.find((account) => account.keys.includes(key));

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight">Accounts and sources</h1>
        <OpenBankingAccountsControl />
        <EmptyLedger>
          Every account BitbyBit reads will appear here under the bank it belongs to, ready to be
          named or merged when one account arrives written two different ways.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts and sources</h1>
      <p className="mt-2 text-muted">
        Every account BitbyBit has read, under the bank it belongs to. Name one to recognise it next
        time, or merge two that turned out to be the same account. Merging is permanent, for
        duplicate products only. To group accounts without merging, use Pools.
      </p>
      {mergeError ? <p className="mt-3 text-sm text-negative">{mergeError}</p> : null}

      <OpenBankingAccountsControl />

      <FeatureEnableOffer />

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Interpreted net flow"
          value={formatAud(flow.cashNet)}
          detail={flow.periodLabel}
          positive
        />
        <SummaryCard
          label="Accounts in view"
          value={String(accounts.length)}
          detail={`Across ${groups.length} institution${groups.length === 1 ? "" : "s"}`}
        />
        <SummaryCard
          label="Documents interpreted"
          value={String(files.filter((file) => file.processingStatus === "completed").length)}
          detail="CSV and OCR photos"
        />
      </section>

      <PayerSuggestions />

      <IncomeRhythm />

      {poolsOn ? <PoolsWidget /> : null}

      {suggestions.length > 0 ? (
        <section className="mt-8 rounded-[var(--radius-card)] border border-attention-line bg-attention-surface p-6">
          <h2 className="text-lg font-bold">These might be the same account</h2>
          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion) => {
              const keep = accountFor(suggestion.keep);
              const drop = accountFor(suggestion.merge);
              if (!keep || !drop) return null;
              return (
                <div key={`${suggestion.keep}-${suggestion.merge}`} className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-attention-ink">{suggestion.reason}</p>
                  <button
                    type="button"
                    onClick={() => merge(drop, keep)}
                    className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary"
                  >
                    Merge them
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">
            Merging is permanent, for duplicate products only. To group without merging, use Pools.
          </p>
        </section>
      ) : null}

      <section className="mt-8 space-y-8">
        {poolsOn ? (
          <PoolFilter
            pools={pools}
            value={poolFilter}
            onChange={setPoolFilter}
            unpooledCount={accounts.filter((account) => poolsForAccount(poolBook, account.id).length === 0).length}
          />
        ) : null}
        {poolsOn && poolFilter !== "all"
          ? poolSections(accounts, poolBook, pools, poolFilter).map((section) => (
              <div key={section.title}>
                <div className="flex items-baseline justify-between border-b border-line pb-2">
                  <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-muted">{section.title}</h2>
                  <p className="text-sm text-muted">
                    {section.accounts.length} account{section.accounts.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {section.accounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      name={nameOf(account)}
                      siblings={accounts.filter((other) => other.id !== account.id)}
                      poolNames={poolsForAccount(poolBook, account.id).map((pool) => pool.name)}
                      onRename={(name) => rename(account, name)}
                      onMerge={(into) => merge(account, into)}
                    />
                  ))}
                </div>
              </div>
            ))
          : groups.map((group) => (
          <div key={group.institution}>
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-muted">{group.institution}</h2>
              <p className="text-sm text-muted">
                {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {group.accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  name={nameOf(account)}
                  siblings={group.accounts.filter((other) => other.id !== account.id)}
                  poolNames={poolsOn ? poolsForAccount(poolBook, account.id).map((pool) => pool.name) : []}
                  onRename={(name) => rename(account, name)}
                  onMerge={(into) => merge(account, into)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {files.length > 0 ? (
        <article className="mt-8 card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Uploaded documents</h2>
            <Link href="/upload" className="text-sm font-semibold text-ink-soft">
              Upload more
            </Link>
          </div>
          <div className="mt-4 divide-y divide-surface-subtle">
            {files.map((file) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={file.filename}>
                <div>
                  <p className="font-semibold">{file.filename}</p>
                  <p className="mt-1 text-sm text-muted">
                    {file.kind.toUpperCase()} · {file.processingStatus}
                    {file.transactionCount ? ` · ${file.transactionCount} movements` : ""}
                  </p>
                </div>
                <InlineName
                  id={`institution-${file.filename}`}
                  label={`Bank for ${file.filename}`}
                  value={institutionForStatement(file.filename, allTransactions, institutionOverrides)}
                  placeholder="NAB, Up, …"
                  empty={UNKNOWN_INSTITUTION}
                  emptyPrompt="Name the bank"
                  options={knownInstitutions()}
                  onSave={(next) => setStatementInstitution(file.filename, next)}
                />
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </>
  );
}

function PoolFilter({
  pools,
  value,
  onChange,
  unpooledCount,
}: {
  pools: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  unpooledCount: number;
}) {
  const chips = [
    { id: "all", label: "All" },
    ...pools.map((pool) => ({ id: pool.id, label: pool.name })),
    { id: "unpooled", label: "Not in a pool" },
  ];
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted">Filter by pool</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              value === chip.id ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink-soft"
            }`}
          >
            {chip.label}
            {chip.id === "unpooled" ? ` (${unpooledCount})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function poolSections(
  accounts: AccountTotals[],
  book: PoolBook,
  pools: { id: string; name: string }[],
  filter: string,
): { title: string; accounts: AccountTotals[] }[] {
  if (filter === "unpooled") {
    return [
      {
        title: "Not in a pool",
        accounts: accounts.filter((account) => poolsForAccount(book, account.id).length === 0),
      },
    ];
  }
  const pool = pools.find((item) => item.id === filter);
  if (!pool) return [];
  const ids = new Set(
    book.members.filter((member) => member.poolId === pool.id).map((member) => member.accountId),
  );
  return [{ title: pool.name, accounts: accounts.filter((account) => ids.has(account.id)) }];
}

function AccountCard({
  account,
  name,
  siblings,
  poolNames,
  onRename,
  onMerge,
}: {
  account: AccountTotals;
  name: string;
  siblings: AccountTotals[];
  poolNames: string[];
  onRename: (name: string) => void;
  onMerge: (into: AccountTotals) => void;
}) {
  return (
    <article className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{name}</h3>
          <p className="mt-1 text-sm text-muted">
            {account.transactions.length} movement{account.transactions.length === 1 ? "" : "s"}
            {account.named ? " · named" : ""}
          </p>
        </div>
        <InlineName
          id={`account-${account.id}`}
          label={`Name for ${name}`}
          value={name}
          placeholder="Everyday, Rent, …"
          empty=""
          emptyPrompt="Name it"
          options={[]}
          onSave={onRename}
        />
      </div>

      <p className="mt-4 text-2xl font-bold">{formatAud(account.flow.cashNet)}</p>
      <p className="mt-1 text-sm text-muted">
        {formatAud(account.flow.cashIn)} in · {formatAud(account.flow.cashOut)} out
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {account.keys.map((key) => (
          <span key={key} className="rounded-full bg-surface-subtle px-3 py-1 font-mono text-xs text-muted">
            {key}
          </span>
        ))}
        {poolNames.map((pool) => (
          <span key={pool} className="rounded-full bg-accent-surface px-3 py-1 text-xs font-semibold text-ink-soft">
            {pool}
          </span>
        ))}
      </div>

      {siblings.length > 0 ? (
        <label className="mt-4 flex items-center gap-2 text-sm text-muted">
          <span className="shrink-0">Same as</span>
          <select
            value=""
            onChange={(event) => {
              const into = siblings.find((other) => other.id === event.target.value);
              if (into) onMerge(into);
            }}
            className="w-full rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
          >
            <option value="">Another account…</option>
            {siblings.map((other) => (
              <option key={other.id} value={other.id}>
                {other.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {siblings.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          Merging is permanent, for duplicate products only. To group without merging, use Pools.
        </p>
      ) : null}
    </article>
  );
}

/** Naming beats guessing, so whatever was read is only ever a starting point. */
function InlineName({
  id,
  label,
  value,
  placeholder,
  empty,
  emptyPrompt,
  options,
  onSave,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  empty: string;
  emptyPrompt: string;
  options: string[];
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === empty ? "" : value);
  const listId = `${id}-options`.replace(/[^a-zA-Z0-9-]+/g, "-");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value === empty ? "" : value);
          setEditing(true);
        }}
        className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
          value === empty
            ? "border-dashed border-line-dashed text-muted"
            : "border-line bg-surface text-ink-soft"
        }`}
      >
        {value === empty ? emptyPrompt : "Rename"}
      </button>
    );
  }

  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={listId}>
        {label}
      </label>
      <input
        id={listId}
        list={options.length > 0 ? `${listId}-list` : undefined}
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setEditing(false);
        }}
        className="w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
      />
      {options.length > 0 ? (
        <datalist id={`${listId}-list`}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      <button type="button" onClick={save} className="rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary">
        Save
      </button>
    </div>
  );
}
