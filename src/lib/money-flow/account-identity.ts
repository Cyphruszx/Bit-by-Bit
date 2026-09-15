/**
 * What a statement says about which account it belongs to, and how two statements
 * describing the same account are recognised as one.
 *
 * Banks name an account four different ways — a number in a column, a number in a page
 * header, a card with all but the last digits hidden, or a name like "Tax" — and the
 * same account often arrives twice in two of those forms. Nothing here merges two
 * accounts on a hunch: a shared number is proof, a shared last-four is only a
 * suggestion for the person to accept.
 */

import { institutionOf, type InstitutionOverrides } from "@/lib/money-flow/institution";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/** Enough of a statement to carry its letterhead, without reading a year of movements. */
const HEADER_WINDOW = 1500;

/** Australian account numbers run 6 to 10 digits; NZ adds a suffix, so allow more. */
const MIN_DIGITS = 5;
const MAX_DIGITS = 16;

// The number must not run past the end of its own line: a statement whose next line
// opens with a date would otherwise have "15 May" read as more of the account number.
const ACCOUNT_LINE = /\baccount[^\S\n]*(?:number|no\.?|#)?[^\S\n]*:?[^\S\n]*((?:\d[\d -]{3,20}))/gi;
const BSB_LINE = /\bbsb\s*:?\s*(\d{3}[\s-]?\d{3})\b/gi;
const MASKED = /(?:[*x·•]{2,}|\bending(?:\s+in)?)\s*(\d{3,4})\b/gi;

export type AccountRef = {
  /** A full account number, digits only, when the statement prints one. */
  number?: string;
  /** The last digits of a card or account the statement otherwise hides. */
  mask?: string;
  /** A name the statement gives the account, like "Tax" or "Spending". */
  name?: string;
};

export function normalizeAccountNumber(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return undefined;
  // A leading zero is part of the number, so nothing is trimmed.
  return digits;
}

export function normalizeMask(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 4 ? digits : undefined;
}

/**
 * Reads the account a statement claims for itself, from the letterhead rather than the
 * movements. A BSB is kept apart from the account number it sits beside, because on its
 * own it names a branch and not an account.
 */
export function accountRefFromText(text: string): AccountRef {
  const header = text.slice(0, HEADER_WINDOW);
  const bsbs = new Set<string>();
  for (const match of header.matchAll(BSB_LINE)) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length === 6) bsbs.add(digits);
  }

  for (const match of header.matchAll(ACCOUNT_LINE)) {
    const number = normalizeAccountNumber(match[1]);
    if (number && !bsbs.has(number)) return { number };
  }

  for (const match of header.matchAll(MASKED)) {
    const mask = normalizeMask(match[1]);
    if (mask) return { mask };
  }

  return {};
}

/**
 * The key a movement is filed under before anyone has named anything. A number is the
 * strongest, because the same number in the same bank is the same account however the
 * statement was exported; a statement's own name for itself comes next; and a statement
 * that says nothing becomes an account of its own rather than being merged with another
 * on the strength of sharing a bank.
 */
export function accountKeyFrom(ref: AccountRef & { institution: string; statement: string }): string {
  const within =
    ref.number ??
    (ref.mask ? `···${ref.mask}` : undefined) ??
    ref.name?.trim() ??
    ref.statement;
  return `${ref.institution} · ${within}`;
}

/** What to put in front of the person when asking them to name a newly seen account. */
export function suggestAccountName(ref: AccountRef & { institution: string; statement: string }): string {
  if (ref.name?.trim()) return ref.name.trim();
  if (ref.number) return `${ref.institution} ···${ref.number.slice(-3)}`;
  if (ref.mask) return `${ref.institution} ···${ref.mask}`;
  const base = ref.statement.split(/[/\\]/).pop() ?? ref.statement;
  const stripped = base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").trim();
  if (!stripped) return `${ref.institution} account`;
  // A file named after the bank says nothing the institution has not already said.
  const sameThing = stripped.toLowerCase().replace(/\s+/g, "") === ref.institution.toLowerCase().replace(/\s+/g, "");
  if (sameThing) return `${ref.institution} account`;
  return `${ref.institution} · ${stripped}`;
}

/**
 * The key a statement filed this movement under, before anyone renamed anything. A
 * statement that named no account at all becomes an account of its own rather than
 * being merged with another on the strength of sharing a bank.
 */
export function observedAccountKey(
  txn: InterpretedTransaction,
  overrides: InstitutionOverrides = {},
): string {
  const filed = txn.accountId?.trim();
  if (filed) return filed;
  return `${institutionOf(txn, overrides)} · ${txn.sourceFile}`;
}

/**
 * Whether the statement actually named the account, or the reader only had the file to go
 * on. It matters for telling a repeat apart from a duplicate: two statements that name
 * different accounts describing the same purchase are two payments, while two that name
 * no account at all are more likely one account's overlapping downloads.
 */
export function namesItsOwnAccount(txn: InterpretedTransaction): boolean {
  const key = observedAccountKey(txn);
  return withinPart(key) !== txn.sourceFile;
}

const SEPARATOR = " · ";

/** The name a person gave an account, against the key the statement filed it under. */
export type AccountNames = Record<string, string>;

export type AccountRegistry = {
  names?: AccountNames;
  institutions?: InstitutionOverrides;
  /**
   * Payers a person has said are one, against the wording each was filed under. A bank
   * does not write a payer's name the same way every time, and no reading of the words
   * alone can settle whether two wordings are one payer or two.
   */
  payers?: Record<string, string>;
  /**
   * Spec 6c hard merge: source account id → survivor. Walked for identity and
   * fingerprints. No undo.
   */
  mergedInto?: Record<string, string>;
};

export type AccountKind = "CHECKING" | "SAVINGS" | "CREDIT" | "LOAN" | "MORTGAGE";

export type AccountMeta = {
  currency?: string;
  kind?: AccountKind;
  /**
   * Spec 11 / Spec 9 SoT: accounts.`cleared_balance` (Spec 11 wording
   * `current_cleared_balance`). Display reads this field. Missing means 0 + a
   * soft hint — never invent Σ(CLEARED movements).
   */
  clearedBalance?: number;
};

export const CASH_ACCOUNT_KINDS = new Set<AccountKind>(["CHECKING", "SAVINGS"]);
export const DEBT_ACCOUNT_KINDS = new Set<AccountKind>(["CREDIT", "LOAN", "MORTGAGE"]);

const DEBT_KINDS = DEBT_ACCOUNT_KINDS;
const ASSET_KINDS = CASH_ACCOUNT_KINDS;

/** Follow `merged_into` to the survivor. A cycle returns the id unchanged. */
export function canonicalAccountId(id: string, mergedInto: Record<string, string> = {}): string {
  const seen = new Set<string>();
  let at = id;
  while (mergedInto[at]) {
    if (seen.has(at)) return id;
    seen.add(at);
    at = mergedInto[at];
  }
  return at;
}

/** True when source → survivor would walk back into source. */
export function mergeWouldCycle(
  source: string,
  survivor: string,
  mergedInto: Record<string, string> = {},
): boolean {
  if (source === survivor) return true;
  const seen = new Set<string>([source]);
  let at: string | undefined = survivor;
  while (at) {
    if (seen.has(at)) return true;
    seen.add(at);
    at = mergedInto[at];
  }
  return false;
}

export function inferAccountKind(id: string): AccountKind {
  if (/\bmortgage\b/i.test(id)) return "MORTGAGE";
  if (/\bloan\b/i.test(id)) return "LOAN";
  if (/\bcredit\b/i.test(id)) return "CREDIT";
  if (/\bsavings?\b|\bsaver\b|save!!/i.test(id)) return "SAVINGS";
  return "CHECKING";
}

export function inferAccountCurrency(id: string, meta: Record<string, AccountMeta> = {}): string {
  return meta[id]?.currency?.trim() || "AUD";
}

export function accountKindOf(id: string, meta: Record<string, AccountMeta> = {}): AccountKind {
  return meta[id]?.kind ?? inferAccountKind(id);
}

export function isCashAccountKind(kind: AccountKind): boolean {
  return CASH_ACCOUNT_KINDS.has(kind);
}

export function isDebtAccountKind(kind: AccountKind): boolean {
  return DEBT_ACCOUNT_KINDS.has(kind);
}

/**
 * Live CLEARED balance stored on the account. Spec 11 Cash in pool and Spec 9
 * Linked balances share this field. A missing value is 0, not a sum of rows.
 */
export function clearedBalanceOf(
  id: string,
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): { amount: number; missing: boolean } {
  const at = canonicalAccountId(id, mergedInto);
  const stored = meta[at]?.clearedBalance ?? meta[id]?.clearedBalance;
  if (typeof stored === "number" && Number.isFinite(stored)) return { amount: stored, missing: false };
  return { amount: 0, missing: true };
}

/**
 * Spec 6 hard blocks: currency mismatch, and CREDIT/LOAN/MORTGAGE ↔ CHECKING/SAVINGS.
 */
export function mergeBlockedReason(
  sourceId: string,
  survivorId: string,
  meta: Record<string, AccountMeta> = {},
): string | null {
  const sourceCur = inferAccountCurrency(sourceId, meta);
  const survivorCur = inferAccountCurrency(survivorId, meta);
  if (sourceCur !== survivorCur) {
    return `Cannot merge a ${sourceCur} account into a ${survivorCur} account.`;
  }
  const sourceKind = accountKindOf(sourceId, meta);
  const survivorKind = accountKindOf(survivorId, meta);
  if (
    (DEBT_KINDS.has(sourceKind) && ASSET_KINDS.has(survivorKind)) ||
    (ASSET_KINDS.has(sourceKind) && DEBT_KINDS.has(survivorKind))
  ) {
    return `Cannot merge a ${sourceKind} account into a ${survivorKind} account.`;
  }
  return null;
}

/**
 * Where a movement's money actually sits. Spec 6c walks `merged_into`.
 * A display name is only a label, not a merge.
 */
export function accountIdOf(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  return canonicalAccountId(observedAccountKey(txn, registry.institutions ?? {}), registry.mergedInto ?? {});
}

/** What to show for an account. Naming never fuses two keys. */
export function accountCaption(txn: InterpretedTransaction, registry: AccountRegistry = {}): string {
  const id = accountIdOf(txn, registry);
  const observed = observedAccountKey(txn, registry.institutions ?? {});
  const named = registry.names?.[id]?.trim() || registry.names?.[observed]?.trim();
  if (!named) return accountLabel(id);
  return `${institutionOf(txn, registry.institutions ?? {})}${SEPARATOR}${named}`;
}

/** "NAB · 100200300" reads as "NAB · ···300", because the digits are not the point. */
export function accountLabel(id: string): string {
  return id
    .split(SEPARATOR)
    .map((part) => (/^\d{6,}$/.test(part) ? `···${part.slice(-3)}` : part))
    .join(SEPARATOR);
}

export type MergeSuggestion = {
  /** The account that would remain, which is the one identified most precisely. */
  keep: string;
  merge: string;
  reason: string;
};

/**
 * Accounts that may be the same one seen twice. Only ever offered, never applied: a
 * wrong merge fuses two accounts' totals and is hard to notice afterwards, while a
 * wrong split is visible on the accounts screen and costs one click to fix.
 */
export function mergeSuggestions(keys: string[]): MergeSuggestion[] {
  const suggestions: MergeSuggestion[] = [];
  const seen = new Set<string>();

  for (const masked of keys) {
    const mask = maskedTail(masked);
    if (!mask) continue;
    const institution = institutionPart(masked);

    for (const full of keys) {
      if (full === masked || seen.has(masked)) continue;
      if (institutionPart(full) !== institution) continue;
      const number = numberPart(full);
      if (!number || !number.endsWith(mask)) continue;
      seen.add(masked);
      suggestions.push({
        keep: full,
        merge: masked,
        reason: `${institution} ···${mask} could be the same account as ${number}`,
      });
    }
  }

  return suggestions;
}

function institutionPart(key: string): string {
  return key.split(" · ")[0] ?? key;
}

function withinPart(key: string): string {
  return key.split(" · ").slice(1).join(" · ");
}

function numberPart(key: string): string | undefined {
  const within = withinPart(key);
  return /^\d{5,16}$/.test(within) ? within : undefined;
}

function maskedTail(key: string): string | undefined {
  const within = withinPart(key);
  const match = within.match(/^···(\d{3,4})$/);
  return match?.[1];
}
