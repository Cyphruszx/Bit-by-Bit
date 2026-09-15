"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { interpretUploadedDocuments } from "@/app/actions/interpret-documents";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { useSession } from "@/components/session-store";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { acceptedDropTypes } from "@/lib/money-flow/accept";
import { accountsFrom, suggestNameForKey, type AccountNames } from "@/lib/money-flow/accounts";
import type { InstitutionOverrides } from "@/lib/money-flow/institution";
import {
  applyDraft,
  canConfirmDraft,
  confirmDraftIssues,
  confirmPreviewRows,
  createDraft,
  CSV_WEEKLY_LIMIT,
  detectedBankLabel,
  guestDeviceId,
  localQuotaStore,
  OCR_PAGE_WEEKLY_LIMIT,
  peekQuota,
  quotaSubject,
  tryChargeCsv,
  tryChargeOcr,
  type IngestDraft,
} from "@/lib/money-flow/core-ingest";
import { formatAud, formatSignedAud } from "@/lib/format";
import { describeSpan } from "@/lib/money-flow/parse-values";
import type { HeldStatement, ImportReport } from "@/lib/money-flow/ledger";
import { taxonomyPath } from "@/lib/money-flow/category-book";
import { tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const SAMPLES: Array<{ path: string; label: string }> = [
  { path: "/samples/nab-medicare.csv", label: "NAB everyday account" },
  { path: "/samples/nab-rent.csv", label: "NAB rent and offset account" },
  { path: "/samples/up-2025-07-to-2026-06.txt", label: "Up financial year" },
];

export function UploadStudio({ aiReady = false }: { aiReady?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useSession();
  const {
    accountNames,
    allTransactions,
    clearInterpretation,
    flow,
    hasUploads,
    importDocuments,
    institutionOverrides,
    removeStatement,
    setAccountName,
    statements,
    transactions,
  } = useMoneyFlow();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [draft, setDraft] = useState<IngestDraft | null>(null);
  const [quotaLabel, setQuotaLabel] = useState<string>("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    refreshQuota();
    // First paint has no device id until this client effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  function actor() {
    return { userId: session?.userId, deviceId: guestDeviceId() };
  }

  function refreshQuota() {
    const usage = peekQuota(localQuotaStore(), quotaSubject(actor()));
    setQuotaLabel(
      `${CSV_WEEKLY_LIMIT - usage.csv} CSV and ${OCR_PAGE_WEEKLY_LIMIT - usage.ocrPages} OCR pages left this AU week`,
    );
  }

  function interpret(list: File[]) {
    if (list.length === 0) return;
    if (list.length > 1) {
      setError("Upload one file at a time.");
      return;
    }
    const formData = new FormData();
    formData.append("files", list[0]);
    setError(null);
    startTransition(async () => {
      const store = localQuotaStore();
      const subject = quotaSubject(actor());
      const ocrGuess = /\.(png|jpe?g|webp|gif|heic)$/i.test(list[0].name) || list[0].type.startsWith("image/");
      if (ocrGuess) {
        const charged = tryChargeOcr(store, subject, 1);
        if (!charged.ok) {
          setError("This week's 20 OCR pages are used.");
          refreshQuota();
          return;
        }
      }
      const hashes = await hashFiles(list);
      const result = await interpretUploadedDocuments(formData);
      if (!result.ok) {
        setError(result.error);
        refreshQuota();
        return;
      }
      setDraft(createDraft(result, hashes));
      refreshQuota();
    });
  }

  function confirmDraft() {
    if (!draft || !canConfirmDraft(draft)) return;
    setError(null);
    const store = localQuotaStore();
    const subject = quotaSubject(actor());
    if (draft.channel === "csv") {
      const charged = tryChargeCsv(store, subject);
      if (!charged.ok) {
        setError("This week's 5 CSV imports are used.");
        refreshQuota();
        return;
      }
    }
    setReport(importDocuments(applyDraft(draft), draft.hashes));
    setDraft(null);
    refreshQuota();
  }

  function abandonDraft() {
    setDraft(null);
    setError(null);
    refreshQuota();
  }

  async function loadSample(path: string) {
    const response = await fetch(path);
    const blob = await response.blob();
    const name = path.split("/").pop() ?? "sample";
    interpret([new File([blob], name, { type: blob.type })]);
  }

  return (
    <div className="space-y-8">
      <section
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          interpret([...event.dataTransfer.files]);
        }}
        className={`rounded-3xl border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-primary bg-accent-surface" : "border-line bg-surface"
        }`}
      >
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted">Core feature</p>
        <h2 className="mt-2 text-2xl font-bold">Drop a CSV or a photo</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Core ingest is CSV and OCR only — one file at a time. Excel, OFX, and QIF are unavailable. Photograph a
          statement page for OCR; digital PDF is not a Core path
          {aiReady
            ? ". AI vision can read photos and suggest tags when a merchant is still unlabelled."
            : ". Add OPENAI_API_KEY to .env.local to let AI read receipt photos; until then, photos use on-device OCR."}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={acceptedDropTypes()}
          className="hidden"
          onChange={(event) => interpret([...(event.target.files ?? [])])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending || Boolean(draft)}
          className="mt-6 rounded-full bg-primary px-6 py-3 font-bold text-on-primary disabled:opacity-60"
        >
          {pending ? (aiReady ? "Reading with AI…" : "Reading documents…") : "Choose a file"}
        </button>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => loadSample(sample.path)}
              disabled={pending || Boolean(draft)}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft"
            >
              Try {sample.label}
            </button>
          ))}
        </div>
        {quotaLabel ? <p className="mt-4 text-sm text-muted">{quotaLabel}</p> : null}
        {error ? <p className="mt-4 text-sm text-negative">{error}</p> : null}
        {report ? <p className="mt-4 text-sm text-ink-soft">{describeImport(report)}</p> : null}
      </section>

      {draft ? (
        <ConfirmMapper
          draft={draft}
          quotaLabel={quotaLabel}
          onChange={setDraft}
          onConfirm={confirmDraft}
          onAbandon={abandonDraft}
        />
      ) : null}

      {report ? (
        <NameArrivedAccounts
          statements={report.imports.map((record) => record.label)}
          transactions={allTransactions}
          names={accountNames}
          institutions={institutionOverrides}
          onName={setAccountName}
        />
      ) : null}

      {hasUploads ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Money in" value={formatAud(flow.cashIn)} detail={flow.periodLabel} positive />
            <SummaryCard label="Money out" value={formatAud(flow.cashOut)} detail={`${flow.transactionCount} movements`} />
            <SummaryCard
              label="Net cash flow"
              value={formatAud(flow.cashNet)}
              detail="Credits minus debits"
              positive={flow.cashNet >= 0}
            />
          </section>
          <article className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Interpreted money flow</h3>
              <button type="button" onClick={clearInterpretation} className="text-sm font-semibold text-ink-soft">
                Clear uploads
              </button>
            </div>
            <ul className="mt-4 space-y-2 text-muted">
              {flow.insights.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {flow.categories.slice(0, 6).map((category) => (
                <div key={category.name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{category.name}</span>
                    <span className="text-muted">{formatAud(category.amount)}</span>
                  </div>
                  <ProgressBar value={category.share} />
                </div>
              ))}
            </div>
          </article>
          <article className="card p-6">
            <h3 className="text-lg font-bold">Statements you have added</h3>
            <p className="mt-1 text-sm text-muted">
              Every upload is kept, so you can build up months of activity. Uploading a statement twice adds nothing.
            </p>
            <div className="mt-4 divide-y divide-line">
              {statements.map((statement) => (
                <div className="flex flex-wrap items-start justify-between gap-3 py-3" key={statement.key}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{statement.label}</p>
                    <p className="mt-1 text-sm text-muted">{describeStatement(statement)}</p>
                    {statement.error ? <p className="mt-1 text-sm text-negative">{statement.error}</p> : null}
                    {statement.notes.map((note) => (
                      <p className="mt-1 text-sm text-muted" key={note}>
                        {note}
                      </p>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStatement(statement.key)}
                    className="shrink-0 text-sm font-semibold text-negative"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </article>
          <article className="card p-6">
            <h3 className="text-lg font-bold">Extracted activity</h3>
            <div className="mt-4 divide-y divide-line">
              {transactions.length === 0 ? (
                <p className="py-4 text-sm text-muted">No movements in this period.</p>
              ) : (
                transactions.slice(0, 12).map((txn) => (
                  <div className="flex items-center justify-between py-4" key={txn.id}>
                    <div>
                      <p className="font-semibold">{txn.merchant}</p>
                      <p className="mt-1 text-sm text-muted">
                        {taxonomyPath(txn.categoryKey)}
                        {tagsOf(txn).length > 0 ? ` / ${tagsOf(txn).join(" · ")}` : ""}
                        {txn.decidedBy === "ai" ? " · suggested by AI" : ""} · {txn.date} · {txn.sourceFile}
                      </p>
                    </div>
                    <p className={`font-semibold ${txn.amount > 0 ? "text-positive" : ""}`}>{formatSignedAud(txn.amount)}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </>
      ) : null}
    </div>
  );
}

function describeImport(report: ImportReport): string {
  const documents = `${report.imports.length} document${report.imports.length === 1 ? "" : "s"}`;
  if (report.added === 0 && report.duplicates > 0) {
    return `Nothing new in ${documents} — all ${report.duplicates} movements were already here.`;
  }
  const added = `Added ${report.added} movement${report.added === 1 ? "" : "s"} from ${documents}.`;
  return report.duplicates > 0 ? `${added} ${report.duplicates} were already here.` : added;
}

function describeStatement(statement: HeldStatement): string {
  const parts = [statement.kind.toUpperCase()];
  if (statement.from) parts.push(describeSpan(statement.from, statement.to));
  parts.push(`${statement.movements} movement${statement.movements === 1 ? "" : "s"}`);
  if (statement.uploads > 1) parts.push(`uploaded ${statement.uploads} times`);
  return parts.join(" · ");
}

/** Recognises the same file coming back under a different name. */
async function hashFiles(list: File[]): Promise<Record<string, string>> {
  if (typeof crypto === "undefined" || !crypto.subtle) return {};
  const entries = await Promise.all(
    list.map(async (file) => {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return [file.name, hex] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function ConfirmMapper({
  draft,
  quotaLabel,
  onChange,
  onConfirm,
  onAbandon,
}: {
  draft: IngestDraft;
  quotaLabel: string;
  onChange: (draft: IngestDraft) => void;
  onConfirm: () => void;
  onAbandon: () => void;
}) {
  const ready = canConfirmDraft(draft);
  const multi = draft.sections.length > 1;
  const bank = detectedBankLabel(draft);
  const issues = confirmDraftIssues(draft);
  const blockers = issues.filter((issue) => issue.severity === "block");
  const notes = issues.filter((issue) => issue.severity === "warn");
  const preview = confirmPreviewRows(draft);
  const total = draft.result.transactions.length;
  return (
    <section className="card p-6">
      <h2 className="text-lg font-bold">Confirm & import</h2>
      <p className="mt-1 text-sm text-muted">
        {draft.channel === "csv"
          ? "A CSV slot is used only when you confirm. Discard now and nothing is charged."
          : "OCR pages were charged when this photo was read. Confirm writes the rows."}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Detected bank</dt>
          <dd className="mt-1 font-semibold">{bank}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Channel</dt>
          <dd className="mt-1 font-semibold">{draft.channel === "csv" ? "CSV" : "OCR"}</dd>
        </div>
      </dl>
      {quotaLabel ? <p className="mt-3 text-sm text-muted">{quotaLabel}</p> : null}
      {multi ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold">Assign every account before import</p>
          {draft.sections.map((section, index) => (
            <label key={section.accountId} className="block text-sm">
              {section.accountId}
              <input
                className="mt-1 w-full rounded-full border border-line bg-surface px-3 py-2 text-ink"
                value={section.assignedTo}
                placeholder="Assign this section"
                onChange={(event) => {
                  const sections = draft.sections.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, assignedTo: event.target.value } : item,
                  );
                  onChange({ ...draft, sections });
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-negative bg-negative-surface p-4">
          {blockers.map((issue) => (
            <p className="text-sm font-semibold text-negative" key={issue.message}>
              {issue.message}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {total} movement{total === 1 ? "" : "s"} ready to import.
        </p>
      )}
      {notes.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-attention-line bg-attention-surface p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-attention">How this file was read</p>
          <ul className="mt-2 space-y-1">
            {notes.map((issue) => (
              <li className="text-sm text-attention-ink" key={issue.message}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <MappedPreviewTable rows={preview} total={total} showAccount={multi} />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!ready}
          onClick={onConfirm}
          className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
        >
          Confirm & import
        </button>
        <button
          type="button"
          onClick={onAbandon}
          className="rounded-full border border-line bg-surface px-5 py-2 text-sm font-semibold text-ink-soft"
        >
          Discard
        </button>
      </div>
    </section>
  );
}

function MappedPreviewTable({
  rows,
  total,
  showAccount,
}: {
  rows: ReturnType<typeof confirmPreviewRows>;
  total: number;
  showAccount: boolean;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">Mapped preview</h3>
        <p className="text-xs text-muted">
          {rows.length < total
            ? `Showing first ${rows.length} of ${total} movements`
            : `${total} movement${total === 1 ? "" : "s"}`}
        </p>
      </div>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-surface-subtle text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              {showAccount ? <th className="px-3 py-2">Account</th> : null}
              <th className="px-3 py-2">Direction</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{row.date}</td>
                <td className="px-3 py-2 font-medium">{row.description}</td>
                {showAccount ? <td className="px-3 py-2 text-muted">{row.account ?? "—"}</td> : null}
                <td className="px-3 py-2 text-muted">
                  {row.direction === "in" ? "In" : row.direction === "out" ? "Out" : "—"}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${
                    row.amount > 0 ? "text-positive" : ""
                  }`}
                >
                  {formatSignedAud(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Naming an account once is what lets the next statement from it be recognised, so the
 * moment after an import is when to ask. The reader's own suggestion is filled in, and
 * a person who skips loses nothing: the account keeps the key its statement gave it.
 */
function NameArrivedAccounts({
  statements,
  transactions,
  names,
  institutions,
  onName,
}: {
  statements: string[];
  transactions: InterpretedTransaction[];
  names: AccountNames;
  institutions: InstitutionOverrides;
  onName: (accountKey: string, name: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const arrived = new Set(statements);
  const pending = accountsFrom(
    transactions.filter((txn) => arrived.has(txn.sourceFile)),
    { names, institutions },
  ).filter((account) => !account.named);

  if (pending.length === 0) return null;

  return (
    <section className="card p-6">
      <h2 className="text-lg font-bold">What should these accounts be called?</h2>
      <p className="mt-1 text-sm text-muted">
        Naming one now means the next statement from it lands in the same place, whichever
        format it arrives in. Skip and it keeps the name its statement gave it.
      </p>
      <div className="mt-4 space-y-3">
        {pending.map((account) => {
          const suggestion =
            drafts[account.id] ??
            suggestNameForKey(account.keys[0], account.transactions[0]?.sourceFile ?? account.keys[0]);
          return (
            <div key={account.id} className="flex flex-wrap items-center gap-3 border-b border-line pb-3 last:border-0">
              <div className="min-w-40 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">{account.institution}</p>
                <p className="font-mono text-sm text-muted">{account.keys[0]}</p>
                <p className="mt-1 text-sm text-muted">
                  {account.transactions.length} movement{account.transactions.length === 1 ? "" : "s"} ·{" "}
                  {formatAud(account.flow.cashNet)} net
                </p>
              </div>
              <input
                aria-label={`Name for ${account.keys[0]}`}
                value={suggestion}
                onChange={(event) => setDrafts((held) => ({ ...held, [account.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    for (const key of account.keys) onName(key, suggestion);
                  }
                }}
                className="w-48 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink"
              />
              <button
                type="button"
                onClick={() => {
                  for (const key of account.keys) onName(key, suggestion);
                }}
                className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary"
              >
                Save
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
