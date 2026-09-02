"use client";

import Link from "next/link";
import { useState } from "react";
import { demoAccounts, useMoneyFlow } from "@/components/money-flow-provider";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import {
  institutionForStatement,
  knownInstitutions,
  UNKNOWN_INSTITUTION,
} from "@/lib/money-flow/institution";

export function AccountsView() {
  const { files, flow, hasUploads, allTransactions, institutionOverrides, setStatementInstitution } = useMoneyFlow();
  const total = demoAccounts.reduce((sum, account) => sum + account.balance, 0);
  const completed = files.filter((file) => file.processingStatus === "completed").length;

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">
        {hasUploads ? flow.periodLabel : "Upload to interpret"}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Accounts and sources</h1>
      <p className="mt-2 text-[#60716a]">
        {hasUploads
          ? "Documents already interpreted in this browser. The period filter changes the net flow from those files."
          : "Placeholder balances until you upload statements. Use the period filter on Dashboard and Transactions to slice sample activity."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label={hasUploads ? "Interpreted net flow" : "Net across accounts"}
          value={formatAud(hasUploads ? flow.cashNet : total)}
          detail={hasUploads ? flow.periodLabel : "Everyday, savings, and card"}
          positive
        />
        <SummaryCard label="Accounts in view" value={String(demoAccounts.length)} detail="Demo institutions only" />
        <SummaryCard
          label="Documents interpreted"
          value={String(completed)}
          detail="CSV, Excel, PDF, OFX, images, and more"
        />
      </section>
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
                <InstitutionName
                  statementKey={file.filename}
                  institution={institutionForStatement(file.filename, allTransactions, institutionOverrides)}
                  named={Boolean(institutionOverrides[file.filename])}
                  onName={(next) => setStatementInstitution(file.filename, next)}
                />
              </div>
            ))}
          </div>
        </article>
      ) : null}
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
    </>
  );
}

/** Naming the bank beats guessing at it, so the reader's answer is only a starting point. */
function InstitutionName({
  statementKey,
  institution,
  named,
  onName,
}: {
  statementKey: string;
  institution: string;
  named: boolean;
  onName: (institution: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(institution === UNKNOWN_INSTITUTION ? "" : institution);
  const listId = `institutions-${statementKey.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(institution === UNKNOWN_INSTITUTION ? "" : institution);
          setEditing(true);
        }}
        className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
          institution === UNKNOWN_INSTITUTION
            ? "border-dashed border-[#c3d2ca] text-[#77857f]"
            : "border-[#dce4df] bg-white text-[#355a3f]"
        }`}
      >
        {institution === UNKNOWN_INSTITUTION ? "Name the bank" : institution}
        {named ? " · named" : ""}
      </button>
    );
  }

  const save = () => {
    onName(draft);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={listId}>
        Bank for {statementKey}
      </label>
      <input
        id={listId}
        list={`${listId}-options`}
        autoFocus
        value={draft}
        placeholder="NAB, Up, …"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setEditing(false);
        }}
        className="w-40 rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm"
      />
      <datalist id={`${listId}-options`}>
        {knownInstitutions().map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button type="button" onClick={save} className="rounded-full bg-[#173b31] px-3 py-1.5 text-sm font-semibold text-white">
        Save
      </button>
    </div>
  );
}
