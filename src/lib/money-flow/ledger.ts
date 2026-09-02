import { tidyInstitutionName, type InstitutionOverrides } from "@/lib/money-flow/institution";
import type { FileInterpretation, FileKind, InterpretedTransaction } from "@/lib/money-flow/types";

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
  kind: FileKind;
  notes: string[];
  contentHash?: string;
  accountKeys: string[];
  from: string;
  to: string;
  rows: number;
  added: number;
  duplicates: number;
  error?: string;
  /** Set when the same file content was imported before, so nothing was read again. */
  repeatOf?: string;
};

export type Ledger = {
  version: number;
  entries: LedgerEntry[];
  imports: LedgerImport[];
  /**
   * The institution a person named for a statement, keyed by that statement. Kept
   * beside the movements rather than on them, so correcting a name never rewrites
   * a movement's identity.
   */
  institutions?: InstitutionOverrides;
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

  grouped(result).forEach(({ label, file, rows }, index) => {
    const filename = file?.filename ?? label;
    const contentHash = options.hashes?.[filename];
    const record: LedgerImport = {
      id: `${importedAt}-${index}-${slug(label)}`,
      label,
      filename,
      importedAt,
      kind: file?.kind ?? "unknown",
      notes: file?.notes ?? [],
      ...(contentHash ? { contentHash } : {}),
      ...(file?.processingError ? { error: file.processingError } : {}),
      accountKeys: unique(rows.map(accountOf)),
      from: rows.length > 0 ? rows.reduce((min, row) => (row.dateIso < min ? row.dateIso : min), rows[0].dateIso) : "",
      to: rows.length > 0 ? rows.reduce((max, row) => (row.dateIso > max ? row.dateIso : max), rows[0].dateIso) : "",
      rows: rows.length,
      added: 0,
      duplicates: 0,
    };

    if (rows.length === 0) {
      imports.push(record);
      return;
    }

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
      ...ledger,
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

export type HeldStatement = {
  key: string;
  label: string;
  kind: FileKind;
  notes: string[];
  accountKeys: string[];
  from: string;
  to: string;
  /** Movements the ledger still holds from this statement. */
  movements: number;
  /** How many times it has been uploaded. */
  uploads: number;
  addedAt: string;
  error?: string;
};

/**
 * One row per statement rather than per upload, so uploading the same file again
 * does not read as a second document.
 */
export function heldStatements(ledger: Ledger): HeldStatement[] {
  const byKey = new Map<string, HeldStatement>();
  const importsFor = new Map<string, Set<string>>();

  for (const record of ledger.imports) {
    const key = record.label;
    const ids = importsFor.get(key) ?? new Set<string>();
    ids.add(record.id);
    importsFor.set(key, ids);

    const held = byKey.get(key);
    byKey.set(key, {
      key,
      label: record.label,
      kind: held?.kind ?? record.kind,
      notes: record.notes.length > 0 ? record.notes : (held?.notes ?? []),
      accountKeys: unique([...(held?.accountKeys ?? []), ...record.accountKeys]),
      from: earliest(held?.from, record.from),
      to: latest(held?.to, record.to),
      movements: 0,
      uploads: (held?.uploads ?? 0) + 1,
      addedAt: held?.addedAt ?? record.importedAt,
      ...(record.error ? { error: record.error } : held?.error ? { error: held.error } : {}),
    });
  }

  for (const entry of ledger.entries) {
    for (const [key, ids] of importsFor) {
      if (!entry.importIds.some((id) => ids.has(id))) continue;
      const held = byKey.get(key);
      if (held) held.movements += 1;
      break;
    }
  }

  return [...byKey.values()];
}

/** Removes a statement however many times it was uploaded. */
export function removeStatement(ledger: Ledger, key: string): Ledger {
  const dropped = ledger.imports
    .filter((record) => record.label === key)
    .reduce((next, record) => removeImport(next, record.id), ledger);
  return nameInstitution(dropped, key, "");
}

export function removeImport(ledger: Ledger, importId: string): Ledger {
  const entries: LedgerEntry[] = [];
  for (const entry of ledger.entries) {
    const importIds = entry.importIds.filter((id) => id !== importId);
    if (importIds.length === 0) continue;
    entries.push(importIds.length === entry.importIds.length ? entry : { ...entry, importIds });
  }
  return {
    ...ledger,
    version: LEDGER_VERSION,
    entries,
    imports: ledger.imports.filter((record) => record.id !== importId),
  };
}

/**
 * Records the institution a person named for a statement. An empty name forgets
 * it again, so detection takes back over.
 */
export function nameInstitution(ledger: Ledger, statementKey: string, institution: string): Ledger {
  const named = tidyInstitutionName(institution);
  const institutions = { ...ledger.institutions };
  if (named) institutions[statementKey] = named;
  else delete institutions[statementKey];
  return { ...ledger, institutions };
}

export function ledgerTransactions(ledger: Ledger): InterpretedTransaction[] {
  return ledger.entries;
}

/** Every statement the ledger holds, described the way the document views expect. */
export function importedFiles(ledger: Ledger): FileInterpretation[] {
  const held = new Map<string, FileInterpretation>();
  for (const record of ledger.imports) {
    const existing = held.get(record.label);
    held.set(record.label, {
      filename: record.label,
      fileType: schemaType(record.kind),
      kind: record.kind,
      uploadStatus: record.error ? "failed" : "uploaded",
      processingStatus: record.error ? "failed" : "completed",
      ...(record.error ? { processingError: record.error } : {}),
      transactionCount: (existing?.transactionCount ?? 0) + record.added,
      notes: record.notes,
    });
  }
  return [...held.values()];
}

function schemaType(kind: FileKind): FileInterpretation["fileType"] {
  if (kind === "csv" || kind === "xlsx" || kind === "pdf" || kind === "image") return kind;
  return "other";
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
  return {
    version: LEDGER_VERSION,
    entries: sortEntries(entries),
    imports: raw.imports,
    ...(raw.institutions && typeof raw.institutions === "object" ? { institutions: namesOnly(raw.institutions) } : {}),
  };
}

type Group = { label: string; file?: FileInterpretation; rows: InterpretedTransaction[] };

/**
 * One group per statement, in upload order rather than the order movements happen
 * to be sorted in. A spreadsheet contributes a group per sheet but hashes against
 * the one uploaded file, and a file that yielded nothing still gets a record so the
 * failure is remembered.
 */
function grouped(result: { files: FileInterpretation[]; transactions: InterpretedTransaction[] }): Group[] {
  const groups = new Map<string, InterpretedTransaction[]>();
  for (const txn of result.transactions) {
    const rows = groups.get(txn.sourceFile) ?? [];
    rows.push(txn);
    groups.set(txn.sourceFile, rows);
  }

  const ordered: Group[] = [];
  for (const file of result.files) {
    const labels = [...groups.keys()].filter(
      (label) => label === file.filename || label.startsWith(`${file.filename} · `),
    );
    if (labels.length === 0) {
      ordered.push({ label: file.filename, file, rows: [] });
      continue;
    }
    for (const label of labels) {
      ordered.push({ label, file, rows: groups.get(label) ?? [] });
      groups.delete(label);
    }
  }
  for (const [label, rows] of groups) ordered.push({ label, rows });
  return ordered;
}

function namesOnly(raw: Record<string, unknown>): InstitutionOverrides {
  return Object.fromEntries(
    Object.entries(raw)
      .filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim().length > 0)
      .map(([key, value]) => [key, tidyInstitutionName(value)]),
  );
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

function earliest(a: string | undefined, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: string | undefined, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || a.fingerprint.localeCompare(b.fingerprint));
}
