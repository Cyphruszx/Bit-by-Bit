import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { FileInterpretation, InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

export type DocumentView = "together" | "separate";

export type DocumentScope = { kind: "all" } | { kind: "file"; sourceFile: string };

export const ALL_DOCUMENTS: DocumentScope = { kind: "all" };

export type DocumentTotals = {
  sourceFile: string;
  label: string;
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
  processingError?: string;
};

export function sourceFilesFrom(transactions: InterpretedTransaction[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const txn of transactions) {
    const name = txn.sourceFile.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    files.push(name);
  }
  return files;
}

export function filterByDocument(
  transactions: InterpretedTransaction[],
  scope: DocumentScope,
): InterpretedTransaction[] {
  if (scope.kind === "all") return transactions;
  return transactions.filter((txn) => txn.sourceFile === scope.sourceFile);
}

export function documentLabel(sourceFile: string): string {
  const base = sourceFile.split(/[/\\]/).pop() || sourceFile;
  const sheet = base.split(" · ");
  return sheet[sheet.length - 1] || base;
}

export function parseDocumentView(value: unknown): DocumentView {
  return value === "separate" ? "separate" : "together";
}

export function parseDocumentScope(value: unknown, sourceFiles: string[]): DocumentScope {
  if (!value || typeof value !== "object") return ALL_DOCUMENTS;
  const record = value as Record<string, unknown>;
  if (record.kind === "file" && typeof record.sourceFile === "string" && sourceFiles.includes(record.sourceFile)) {
    return { kind: "file", sourceFile: record.sourceFile };
  }
  return ALL_DOCUMENTS;
}

export function totalsByDocument(
  files: FileInterpretation[],
  transactions: InterpretedTransaction[],
): DocumentTotals[] {
  const grouped = new Map<string, InterpretedTransaction[]>();
  for (const txn of transactions) {
    const rows = grouped.get(txn.sourceFile) ?? [];
    rows.push(txn);
    grouped.set(txn.sourceFile, rows);
  }

  const fromUploads = files.map((file) => {
    const rows = grouped.get(file.filename) ?? [];
    grouped.delete(file.filename);
    return {
      sourceFile: file.filename,
      label: documentLabel(file.filename),
      transactions: rows,
      flow: summarizeMoneyFlow(rows),
      processingError: file.processingError,
    } satisfies DocumentTotals;
  });

  const leftovers: DocumentTotals[] = [...grouped.entries()].map(([sourceFile, rows]) => ({
    sourceFile,
    label: documentLabel(sourceFile),
    transactions: rows,
    flow: summarizeMoneyFlow(rows),
  }));

  return [...fromUploads, ...leftovers].filter(
    (entry) => entry.transactions.length > 0 || Boolean(entry.processingError) || files.some((file) => file.filename === entry.sourceFile),
  );
}
