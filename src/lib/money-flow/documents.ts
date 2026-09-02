import {
  institutionForStatement,
  institutionKey,
  institutionOf,
  type InstitutionOverrides,
} from "@/lib/money-flow/institution";
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

export type InstitutionTotals = {
  /** Matches "NAB" and "nab" to one group without deciding how it is spelled. */
  key: string;
  label: string;
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
  /** The statements this institution's movements arrived in. */
  documents: DocumentTotals[];
};

export function institutionsFrom(
  transactions: InterpretedTransaction[],
  overrides: InstitutionOverrides = {},
): string[] {
  const seen = new Map<string, string>();
  for (const txn of transactions) {
    const label = institutionOf(txn, overrides);
    if (!seen.has(institutionKey(label))) seen.set(institutionKey(label), label);
  }
  return [...seen.values()];
}

/**
 * One group per bank rather than per uploaded file, so two statements from the same
 * bank read as one source and a bank's own total holds however many files it took to
 * describe it. Each group still carries its documents, because a total nobody can
 * trace back to a statement is not worth much.
 */
export function totalsByInstitution(
  files: FileInterpretation[],
  transactions: InterpretedTransaction[],
  overrides: InstitutionOverrides = {},
): InstitutionTotals[] {
  type Group = { key: string; label: string; transactions: InterpretedTransaction[]; documents: DocumentTotals[] };
  const groups = new Map<string, Group>();

  const groupFor = (label: string): Group => {
    const key = institutionKey(label);
    const held = groups.get(key) ?? { key, label, transactions: [], documents: [] };
    groups.set(key, held);
    return held;
  };

  // Statement order first, so banks appear in the order their statements were uploaded
  // rather than in whatever order the movements happen to be sorted.
  for (const document of totalsByDocument(files, transactions)) {
    groupFor(institutionForDocument(document, overrides)).documents.push(document);
  }
  for (const txn of transactions) groupFor(institutionOf(txn, overrides)).transactions.push(txn);

  return [...groups.values()].map((group) => ({
    key: group.key,
    label: group.label,
    transactions: group.transactions,
    flow: summarizeMoneyFlow(group.transactions),
    documents: group.documents,
  }));
}

/** A statement with no movements left still belongs somewhere, so it is not lost from view. */
function institutionForDocument(document: DocumentTotals, overrides: InstitutionOverrides): string {
  return institutionForStatement(document.sourceFile, document.transactions, overrides);
}
