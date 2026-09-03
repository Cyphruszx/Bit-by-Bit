"use client";

import Link from "next/link";
import { useState } from "react";
import { demoAccounts, useMoneyFlow } from "@/components/money-flow-provider";
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
    setStatementInstitution,
    accountNames,
    setAccountName,
  } = useMoneyFlow();

  const registry = { names: accountNames, institutions: institutionOverrides };
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

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">
        {hasUploads ? flow.periodLabel : "Upload to interpret"}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts and sources</h1>
      <p className="mt-2 text-[#60716a]">
        {hasUploads
          ? "Every account BitbyBit has read, under the bank it belongs to. Name one to recognise it next time, or merge two that turned out to be the same account."
          : "Placeholder balances until you upload statements. Use the period filter on Dashboard and Transactions to slice sample activity."}
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label={hasUploads ? "Interpreted net flow" : "Net across accounts"}
          value={formatAud(hasUploads ? flow.cashNet : demoAccounts.reduce((sum, a) => sum + a.balance, 0))}
          detail={hasUploads ? flow.periodLabel : "Everyday, savings, and card"}
          positive
        />
        <SummaryCard
          label="Accounts in view"
          value={String(hasUploads ? accounts.length : demoAccounts.length)}
          detail={hasUploads ? `Across ${groups.length} institution${groups.length === 1 ? "" : "s"}` : "Demo institutions only"}
        />
        <SummaryCard
          label="Documents interpreted"
          value={String(files.filter((file) => file.processingStatus === "completed").length)}
          detail="CSV, Excel, PDF, OFX, images, and more"
        />
      </section>

      {suggestions.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-[#d8c3a8] bg-[#fdf6ec] p-6">
          <h2 className="text-lg font-bold">These might be the same account</h2>
          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion) => {
              const keep = accountFor(suggestion.keep);
              const drop = accountFor(suggestion.merge);
              if (!keep || !drop) return null;
              return (
                <div key={`${suggestion.keep}-${suggestion.merge}`} className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-[#5c5142]">{suggestion.reason}</p>
                  <button
                    type="button"
                    onClick={() => merge(drop, keep)}
                    className="rounded-full bg-[#173b31] px-4 py-1.5 text-sm font-semibold text-white"
                  >
                    Merge them
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasUploads ? (
        <section className="mt-8 space-y-8">
          {groups.map((group) => (
            <div key={group.institution}>
              <div className="flex items-baseline justify-between border-b border-[#dce4df] pb-2">
                <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{group.institution}</h2>
                <p className="text-sm text-[#77857f]">
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
      ) : (
        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {demoAccounts.map((account) => (
            <article key={account.id} className="rounded-2xl border border-[#dce4df] bg-white p-6">
              <p className="text-sm text-[#60716a]">{account.institution}</p>
              <h2 className="mt-1 text-lg font-bold">{account.name}</h2>
              <p className="mt-4 text-2xl font-bold">{formatAud(account.balance)}</p>
              <p className="mt-1 text-sm text-[#77857f]">{account.accountType}</p>
            </article>
          ))}
        </section>
      )}

      {files.length > 0 ? (
        <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Uploaded documents</h2>
            <Link href="/upload" className="text-sm font-semibold text-[#355a3f]">
              Upload more
            </Link>
          </div>
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {files.map((file) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={file.filename}>
                <div>
                  <p className="font-semibold">{file.filename}</p>
                  <p className="mt-1 text-sm text-[#77857f]">
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
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{name}</h3>
          <p className="mt-1 text-sm text-[#77857f]">
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
      <p className="mt-1 text-sm text-[#77857f]">
        {formatAud(account.flow.cashIn)} in · {formatAud(account.flow.cashOut)} out
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {account.keys.map((key) => (
          <span key={key} className="rounded-full bg-[#f0f4f1] px-3 py-1 font-mono text-xs text-[#60716a]">
            {key}
          </span>
        ))}
      </div>

      {siblings.length > 0 ? (
        <label className="mt-4 flex items-center gap-2 text-sm text-[#60716a]">
          <span className="shrink-0">Same as</span>
          <select
            value=""
            onChange={(event) => {
              const into = siblings.find((other) => other.id === event.target.value);
              if (into) onMerge(into);
            }}
            className="w-full rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm"
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
        className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
          value === empty
            ? "border-dashed border-[#c3d2ca] text-[#77857f]"
            : "border-[#dce4df] bg-white text-[#355a3f]"
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
        className="w-40 rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm"
      />
      {options.length > 0 ? (
        <datalist id={`${listId}-list`}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      <button type="button" onClick={save} className="rounded-full bg-[#173b31] px-3 py-1.5 text-sm font-semibold text-white">
        Save
      </button>
    </div>
  );
}
