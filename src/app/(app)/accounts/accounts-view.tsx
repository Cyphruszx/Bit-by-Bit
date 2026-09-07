"use client";

import Link from "next/link";
import { useState } from "react";
import { IncomeRhythm } from "@/components/income-rhythm";
import { PayerSuggestions } from "@/components/payer-suggestions";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { mergeSuggestions } from "@/lib/money-flow/account-identity";
import { accountsByInstitution, suggestNameForKey, type AccountTotals } from "@/lib/money-flow/accounts";
import {
  institutionForStatement,
  knownInstitutions,
  UNKNOWN_INSTITUTION,
} from "@/lib/money-flow/institution";

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
  } = useMoneyFlow();

  const registry = { names: accountNames, institutions: institutionOverrides, payers };
  const groups = accountsByInstitution(allTransactions, registry);
  const accounts = groups.flatMap((group) => group.accounts);
  const suggestions = mergeSuggestions(accounts.flatMap((account) => account.keys));

  const nameOf = (account: AccountTotals) =>
    accountNames[account.keys[0]]?.trim() ||
    suggestNameForKey(account.keys[0], account.transactions[0]?.sourceFile ?? account.keys[0]);

  const rename = (account: AccountTotals, name: string) => {
    for (const key of account.keys) setAccountName(key, name);
  };

  const merge = (account: AccountTotals, into: AccountTotals) => {
    const name = nameOf(into);
    for (const key of [...into.keys, ...account.keys]) setAccountName(key, name);
  };

  const accountFor = (key: string) => accounts.find((account) => account.keys.includes(key));

  if (!hasUploads) {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight">Accounts and sources</h1>
        <EmptyLedger>
          Every account BitbyBit reads will appear here under the bank it belongs to, ready to be
          named or merged when one account arrives written two different ways.
        </EmptyLedger>
      </>
    );
  }

  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts and sources</h1>
      <p className="mt-2 text-muted">
        Every account BitbyBit has read, under the bank it belongs to. Name one to recognise it next
        time, or merge two that turned out to be the same account.
      </p>

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
          detail="CSV, Excel, PDF, OFX, images, and more"
        />
      </section>

      <PayerSuggestions />

      <IncomeRhythm />

      {suggestions.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-attention-line bg-attention-surface p-6">
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
                    className="rounded-full bg-primary hover:bg-primary-hover px-4 py-1.5 text-sm font-semibold text-on-primary"
                  >
                    Merge them
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-8 space-y-8">
        {groups.map((group) => (
          <div key={group.institution}>
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{group.institution}</h2>
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
                  onRename={(name) => rename(account, name)}
                  onMerge={(into) => merge(account, into)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {files.length > 0 ? (
        <article className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Uploaded documents</h2>
            <Link href="/upload" className="text-sm font-semibold text-ink-soft hover:text-accent">
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

function AccountCard({
  account,
  name,
  siblings,
  onRename,
  onMerge,
}: {
  account: AccountTotals;
  name: string;
  siblings: AccountTotals[];
  onRename: (name: string) => void;
  onMerge: (into: AccountTotals) => void;
}) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-6">
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
        className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold hover:bg-surface-hover ${
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
      <button type="button" onClick={save} className="rounded-full bg-primary hover:bg-primary-hover px-3 py-1.5 text-sm font-semibold text-on-primary">
        Save
      </button>
    </div>
  );
}
