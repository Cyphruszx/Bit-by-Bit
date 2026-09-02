"use client";

import { useRef, useState, useTransition } from "react";
import { interpretUploadedDocuments } from "@/app/actions/interpret-documents";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { acceptedDropTypes } from "@/lib/money-flow/accept";
import { formatAud, formatSignedAud } from "@/lib/format";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import type { HeldStatement, ImportReport } from "@/lib/money-flow/ledger";
import { primaryTag, subTags } from "@/lib/money-flow/tags";

const SAMPLES: Array<{ paths: string[]; label: string }> = [
  { paths: ["/samples/commonwealth-bank.csv"], label: "CSV statement" },
  { paths: ["/samples/nab-medicare.csv", "/samples/nab-rent.csv"], label: "NAB both accounts" },
  { paths: ["/samples/nab-medicare.csv"], label: "NAB everyday account" },
  { paths: ["/samples/nab-rent.csv"], label: "NAB rent and offset account" },
  { paths: ["/samples/up-2025-07-to-2026-06.txt"], label: "Up financial year" },
  { paths: ["/samples/activity.ofx"], label: "OFX export" },
  { paths: ["/samples/receipt-notes.txt"], label: "Text / receipt notes" },
];

export function UploadStudio({ aiReady = false }: { aiReady?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { clearInterpretation, flow, hasUploads, importDocuments, removeStatement, statements, transactions } = useMoneyFlow();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, startTransition] = useTransition();

  function interpret(list: File[]) {
    if (list.length === 0) return;
    const formData = new FormData();
    for (const file of list) formData.append("files", file);
    setError(null);
    startTransition(async () => {
      const hashes = await hashFiles(list);
      const result = await interpretUploadedDocuments(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReport(importDocuments(result, hashes));
    });
  }

  async function loadSample(paths: string[]) {
    const files = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path);
        const blob = await response.blob();
        const name = path.split("/").pop() ?? "sample";
        return new File([blob], name, { type: blob.type });
      }),
    );
    interpret(files);
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
          dragging ? "border-[#173b31] bg-[#edf4dc]" : "border-[#dce4df] bg-white"
        }`}
      >
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Core feature</p>
        <h2 className="mt-2 text-2xl font-bold">Drop almost any money document</h2>
        <p className="mx-auto mt-3 max-w-xl text-[#52625c]">
          Bank CSV and Excel exports, OFX/QIF, PDFs, Word docs, HTML statements, JSON, photos of receipts, and plain
          text. BitbyBit reads the file and interprets money in versus money out
          {aiReady
            ? ", using AI vision on photos and suggesting tags when a merchant is still unlabelled."
            : ". Add OPENAI_API_KEY to .env.local to let AI read receipt photos and suggest tags; until then, photos use on-device OCR and merchant rules."}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedDropTypes()}
          className="hidden"
          onChange={(event) => interpret([...(event.target.files ?? [])])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="mt-6 rounded-full bg-[#d5f06c] px-6 py-3 font-bold text-[#173b31] disabled:opacity-60"
        >
          {pending ? (aiReady ? "Reading with AI…" : "Reading documents…") : "Choose documents"}
        </button>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => loadSample(sample.paths)}
              disabled={pending}
              className="rounded-full border border-[#dce4df] px-4 py-2 text-sm font-semibold text-[#355a3f]"
            >
              Try {sample.label}
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 text-sm text-[#9b3b32]">{error}</p> : null}
        {report ? <p className="mt-4 text-sm text-[#355a3f]">{describeImport(report)}</p> : null}
      </section>

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
          <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Interpreted money flow</h3>
              <button type="button" onClick={clearInterpretation} className="text-sm font-semibold text-[#355a3f]">
                Clear uploads
              </button>
            </div>
            <ul className="mt-4 space-y-2 text-[#52625c]">
              {flow.insights.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {flow.categories.slice(0, 6).map((category) => (
                <div key={category.name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{category.name}</span>
                    <span className="text-[#60716a]">{formatAud(category.amount)}</span>
                  </div>
                  <ProgressBar value={category.share} />
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
            <h3 className="text-lg font-bold">Statements you have added</h3>
            <p className="mt-1 text-sm text-[#60716a]">
              Every upload is kept, so you can build up months of activity. Uploading a statement twice adds nothing.
            </p>
            <div className="mt-4 divide-y divide-[#edf0ee]">
              {statements.map((statement) => (
                <div className="flex flex-wrap items-start justify-between gap-3 py-3" key={statement.key}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{statement.label}</p>
                    <p className="mt-1 text-sm text-[#77857f]">{describeStatement(statement)}</p>
                    {statement.error ? <p className="mt-1 text-sm text-[#9b3b32]">{statement.error}</p> : null}
                    {statement.notes.map((note) => (
                      <p className="mt-1 text-sm text-[#60716a]" key={note}>
                        {note}
                      </p>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStatement(statement.key)}
                    className="shrink-0 text-sm font-semibold text-[#9b3b32]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
            <h3 className="text-lg font-bold">Extracted activity</h3>
            <div className="mt-4 divide-y divide-[#edf0ee]">
              {transactions.length === 0 ? (
                <p className="py-4 text-sm text-[#60716a]">No movements in this period.</p>
              ) : (
                transactions.slice(0, 12).map((txn) => (
                  <div className="flex items-center justify-between py-4" key={txn.id}>
                    <div>
                      <p className="font-semibold">{txn.merchant}</p>
                      <p className="mt-1 text-sm text-[#77857f]">
                        {primaryTag(txn)}
                        {subTags(txn).length > 0 ? ` / ${subTags(txn).join(" · ")}` : ""}
                        {txn.tagSource === "ai" ? " · AI tag" : ""} · {txn.date} · {txn.sourceFile}
                      </p>
                    </div>
                    <p className={`font-semibold ${txn.amount > 0 ? "text-[#257155]" : ""}`}>{formatSignedAud(txn.amount)}</p>
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

/** A statement can run across new year, where bare days and months read backwards. */
function describeSpan(from: string, to: string): string {
  if (from === to) return formatDisplayDate(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = sameYear ? formatDisplayDate(from) : `${formatDisplayDate(from)} ${from.slice(0, 4)}`;
  const end = sameYear ? formatDisplayDate(to) : `${formatDisplayDate(to)} ${to.slice(0, 4)}`;
  return `${start} – ${end}`;
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
