import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * Which bank a movement came from. Grouping money by institution needs a name that
 * survives a re-upload and a renamed file, so detection reads the statement's own
 * wording first and only falls back to weaker signals. Nothing is guessed: a
 * statement with no signal stays unknown until the person names it themselves.
 */
export const UNKNOWN_INSTITUTION = "Unknown source";

/** A statement's institution as the person named it, keyed by the statement it belongs to. */
export type InstitutionOverrides = Record<string, string>;

export type InstitutionSignals = {
  /** The statement's own text, for the wording a bank prints on every page. */
  text?: string;
  /** Column names, for an export whose header row only one bank produces. */
  headers?: string[];
  /** The name a bank writes into an OFX file. */
  org?: string;
  filename?: string;
};

type Profile = {
  label: string;
  /** Wording only this bank's statements carry. */
  statement?: RegExp;
  /** The bank's own name, matched against an OFX header or a filename. */
  name?: RegExp;
  /** Header sets this bank's export produces and others do not. */
  headers?: string[][];
};

const PROFILES: Profile[] = [
  {
    label: "Up",
    statement: /up is a brand of bendigo|zap card \*\*/i,
    name: /\bup(?:bank)?\b/i,
  },
  {
    label: "NAB",
    name: /\bnab\b|national australia bank/i,
    headers: [["merchant name", "transaction type", "category"]],
  },
  { label: "Commonwealth Bank", name: /commonwealth[\s_-]?bank|commbank|\bcba\b/i },
  { label: "ANZ", name: /\banz\b/i },
  { label: "Westpac", name: /westpac/i },
  { label: "Bendigo Bank", name: /bendigo/i },
  { label: "ING", name: /\bing\b/i },
  { label: "Macquarie", name: /macquarie/i },
];

/** Enough of a statement to reach the branding, without scanning a year of movements. */
const BRANDING_WINDOW = 20000;

export function detectInstitution(signals: InstitutionSignals): string | undefined {
  const text = signals.text?.slice(0, BRANDING_WINDOW) ?? "";
  if (text) {
    const branded = PROFILES.find((profile) => profile.statement?.test(text));
    if (branded) return branded.label;
  }

  const headers = (signals.headers ?? []).map(normalizeHeader).filter(Boolean);
  if (headers.length > 0) {
    const shaped = PROFILES.find((profile) =>
      profile.headers?.some((set) => set.every((name) => headers.some((header) => header.includes(name)))),
    );
    if (shaped) return shaped.label;
  }

  const org = signals.org?.trim();
  if (org) {
    const known = PROFILES.find((profile) => profile.name?.test(org));
    // A file that names its own bank is trustworthy even when the bank is new to us.
    return known ? known.label : tidyInstitutionName(org);
  }

  const filename = signals.filename?.split(/[/\\]/).pop();
  if (filename) {
    const named = PROFILES.find((profile) => profile.name?.test(filename));
    if (named) return named.label;
  }

  return undefined;
}

export function withInstitution(
  transactions: InterpretedTransaction[],
  institution: string | undefined,
): InterpretedTransaction[] {
  if (!institution) return transactions;
  return transactions.map((txn) => ({ ...txn, institution }));
}

export function institutionOf(txn: InterpretedTransaction, overrides: InstitutionOverrides = {}): string {
  return overrides[txn.sourceFile]?.trim() || txn.institution?.trim() || UNKNOWN_INSTITUTION;
}

/**
 * What one statement's bank is called, whether the person named it or the reader
 * did. A statement whose movements have all been removed still answers.
 */
export function institutionForStatement(
  statementKey: string,
  transactions: InterpretedTransaction[],
  overrides: InstitutionOverrides = {},
): string {
  const named = overrides[statementKey]?.trim();
  if (named) return named;
  const read = transactions.find((txn) => txn.sourceFile === statementKey && txn.institution?.trim());
  return read?.institution?.trim() || UNKNOWN_INSTITUTION;
}

/** Groups "NAB" and "nab" together without deciding which spelling is shown. */
export function institutionKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

export function tidyInstitutionName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 40);
}

export function knownInstitutions(): string[] {
  return PROFILES.map((profile) => profile.label);
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
