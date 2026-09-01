import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";

export const LEDGER_VERSION = 1;

export type LedgerEntry = InterpretedTransaction & {
  fingerprint: string;
  /** Every import that carried this movement, so removing one import cannot drop a row another still covers. */
  importIds: string[];
  firstSeen: string;
};

export type LedgerImport = {
  id: string;
  label: string;
  filename: string;
  importedAt: string;
  contentHash?: string;
  accountKeys: string[];
  from: string;
  to: string;
  rows: number;
  added: number;
  duplicates: number;
  /** Set when the same file content was imported before, so nothing was read again. */
  repeatOf?: string;
};

export type Ledger = {
  version: number;
  entries: LedgerEntry[];
  imports: LedgerImport[];
};

export type ImportReport = {
  imports: LedgerImport[];
  added: number;
  duplicates: number;
};

export const EMPTY_LEDGER: Ledger = { version: LEDGER_VERSION, entries: [], imports: [] };

export type AppendOptions = {
  importedAt?: string;
  /** Hash per uploaded filename. Lets a renamed re-upload be recognised as the same file. */
  hashes?: Record<string, string>;
};

/**
 * A movement's identity, independent of which file it arrived in. Two statements
 * covering the same week describe the same movement the same way, so the same
 * fingerprint falls out of both and the second one is recognised as already held.
 */
export function fingerprintOf(txn: InterpretedTransaction, occurrence = 0): string {
  return [accountOf(txn), txn.dateIso, txn.amount.toFixed(2), normalize(describe(txn)), occurrence].join("|");
}

export function accountOf(txn: InterpretedTransaction): string {
  const key = txn.accountKey?.trim();
  if (key) return `acct:${normalize(key)}`;
  return `file:${normalize(txn.sourceFile)}`;
}

export function appendToLedger(
  ledger: Ledger,
  result: { files: FileInterpretation[]; transactions: InterpretedTransaction[] },
  options: AppendOptions = {},
): { ledger: Ledger; report: ImportReport } {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const held = new Map(ledger.entries.map((entry) => [entry.fingerprint, entry]));
  const entries = [...ledger.entries];
  const imports: LedgerImport[] = [];

  grouped(result).forEach(([label, rows], index) => {
    const filename = fileFor(label, result.files);
    const contentHash = options.hashes?.[filename];
    const record: LedgerImport = {
      id: `${importedAt}-${index}-${slug(label)}`,
      label,
      filename,
      importedAt,
      ...(contentHash ? { contentHash } : {}),
      accountKeys: unique(rows.map(accountOf)),
      from: rows.reduce((min, row) => (row.dateIso < min ? row.dateIso : min), rows[0].dateIso),
      to: rows.reduce((max, row) => (row.dateIso > max ? row.dateIso : max), rows[0].dateIso),
      rows: rows.length,
      added: 0,
      duplicates: 0,
    };

    const repeat = contentHash ? ledger.imports.find((prior) => prior.contentHash === contentHash) : undefined;
    if (repeat) {
      imports.push({ ...record, duplicates: rows.length, repeatOf: repeat.id });
      return;
    }

    const seen = new Map<string, number>();
    for (const row of rows) {
      const base = fingerprintOf(row);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const fingerprint = occurrence === 0 ? base : fingerprintOf(row, occurrence);

      const existing = held.get(fingerprint);
      if (existing) {
        // Keep the held movement, tags and all, and only note that this import covered it too.
        if (!existing.importIds.includes(record.id)) existing.importIds.push(record.id);
        record.duplicates += 1;
        continue;
      }

      const entry: LedgerEntry = { ...row, fingerprint, importIds: [record.id], firstSeen: importedAt };
      held.set(fingerprint, entry);
      entries.push(entry);
      record.added += 1;
    }

    imports.push(record);
  });

  return {
    ledger: {
      version: LEDGER_VERSION,
      entries: sortEntries(entries),
      imports: [...ledger.imports, ...imports],
    },
    report: {
      imports,
      added: imports.reduce((sum, record) => sum + record.added, 0),
      duplicates: imports.reduce((sum, record) => sum + record.duplicates, 0),
    },
  };
}

export function removeImport(ledger: Ledger, importId: string): Ledger {
  const entries: LedgerEntry[] = [];
  for (const entry of ledger.entries) {
    const importIds = entry.importIds.filter((id) => id !== importId);
    if (importIds.length === 0) continue;
    entries.push(importIds.length === entry.importIds.length ? entry : { ...entry, importIds });
  }
  return {
    version: LEDGER_VERSION,
    entries,
    imports: ledger.imports.filter((record) => record.id !== importId),
  };
}

export function ledgerTransactions(ledger: Ledger): InterpretedTransaction[] {
  return ledger.entries;
}

export function replaceTransactions(ledger: Ledger, transactions: InterpretedTransaction[]): Ledger {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  return {
    ...ledger,
    entries: ledger.entries.map((entry) => {
      const next = byId.get(entry.id);
      return next ? { ...entry, ...next } : entry;
    }),
  };
}

/** Rebuilds a ledger from movements held before imports were tracked. */
export function ledgerFromTransactions(
  transactions: InterpretedTransaction[],
  files: FileInterpretation[],
  importedAt: string,
): Ledger {
  return appendToLedger(EMPTY_LEDGER, { files, transactions }, { importedAt }).ledger;
}

export function parseLedger(value: unknown): Ledger | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Ledger>;
  if (!Array.isArray(raw.entries) || !Array.isArray(raw.imports)) return null;
  const entries = raw.entries.filter(
    (entry): entry is LedgerEntry =>
      Boolean(entry) && typeof entry.fingerprint === "string" && Array.isArray(entry.importIds) && typeof entry.amount === "number",
  );
  return { version: LEDGER_VERSION, entries: sortEntries(entries), imports: raw.imports };
}

/** Grouped in upload order rather than the order movements happen to be sorted in. */
function grouped(result: {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
}): Array<[string, InterpretedTransaction[]]> {
  const groups = new Map<string, InterpretedTransaction[]>();
  for (const txn of result.transactions) {
    const rows = groups.get(txn.sourceFile) ?? [];
    rows.push(txn);
    groups.set(txn.sourceFile, rows);
  }

  const ordered: Array<[string, InterpretedTransaction[]]> = [];
  for (const file of result.files) {
    for (const [label, rows] of groups) {
      if (label !== file.filename && !label.startsWith(`${file.filename} · `)) continue;
      ordered.push([label, rows]);
      groups.delete(label);
    }
  }
  return [...ordered, ...groups.entries()].filter(([, rows]) => rows.length > 0);
}

/** Spreadsheet sheets arrive as "book.xlsx · Sheet1" but hash against the uploaded file. */
function fileFor(label: string, files: FileInterpretation[]): string {
  const match = files.find((file) => label === file.filename || label.startsWith(`${file.filename} · `));
  return match?.filename ?? label;
}

function describe(txn: InterpretedTransaction): string {
  return txn.description?.trim() || txn.merchant;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || a.fingerprint.localeCompare(b.fingerprint));
}
