"use client";

import { useRef, useState, useTransition } from "react";
import { interpretUploadedDocuments } from "@/app/actions/interpret-documents";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { acceptedDropTypes } from "@/lib/money-flow/accept";
import { formatAud, formatSignedAud } from "@/lib/format";
import { primaryTag, subTags } from "@/lib/money-flow/tags";

const SAMPLES = [
  ["/samples/commonwealth-bank.csv", "CSV statement"],
  ["/samples/activity.ofx", "OFX export"],
  ["/samples/receipt-notes.txt", "Text / receipt notes"],
];

export function UploadStudio({ aiReady = false }: { aiReady?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { applyInterpretation, clearInterpretation, files, flow, hasUploads, transactions } = useMoneyFlow();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function interpret(list: File[]) {
    if (list.length === 0) return;
    const formData = new FormData();
    for (const file of list) formData.append("files", file);
    setError(null);
    startTransition(async () => {
      const result = await interpretUploadedDocuments(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyInterpretation(result);
    });
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
          {SAMPLES.map(([path, label]) => (
            <button
              key={path}
              type="button"
              onClick={() => loadSample(path)}
              disabled={pending}
              className="rounded-full border border-[#dce4df] px-4 py-2 text-sm font-semibold text-[#355a3f]"
            >
              Try {label}
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 text-sm text-[#9b3b32]">{error}</p> : null}
      </section>

      {hasUploads ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Money in" value={formatAud(flow.income)} detail={flow.periodLabel} positive />
            <SummaryCard label="Money out" value={formatAud(flow.spending)} detail={`${flow.transactionCount} movements`} />
            <SummaryCard label="Net cash flow" value={formatAud(flow.net)} detail="Income minus spending" positive={flow.net >= 0} />
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
            <h3 className="text-lg font-bold">Documents read</h3>
            <div className="mt-4 divide-y divide-[#edf0ee]">
              {files.map((file) => (
                <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={file.filename}>
                  <div>
                    <p className="font-semibold">{file.filename}</p>
                    <p className="mt-1 text-sm text-[#77857f]">
                      {file.kind.toUpperCase()} · {file.processingStatus}
                      {file.transactionCount ? ` · ${file.transactionCount} movements` : ""}
                    </p>
                    {file.processingError ? <p className="mt-1 text-sm text-[#9b3b32]">{file.processingError}</p> : null}
                    {file.notes.map((note) => (
                      <p className="mt-1 text-sm text-[#60716a]" key={note}>
                        {note}
                      </p>
                    ))}
                  </div>
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
