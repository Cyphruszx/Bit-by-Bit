import {
  accountKindOf,
  canonicalAccountId,
  type AccountMeta,
  type BalanceSource,
} from "@/lib/money-flow/account-identity";
import { parseAmount, roundMoney } from "@/lib/money-flow/parse-values";
import { sourceValue } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export const ESTIMATED_BALANCE_LABEL = "Estimated from movements";
export const NO_OPENING_BALANCE_LABEL = "No opening balance";
export const NO_OPENING_BALANCE_PROMPT = "Enter it by hand, or connect your bank (Open Banking).";
export const NEGATIVE_ESTIMATE_WARNING =
  "This estimate is negative. It is not the balance the bank printed.";

type BalanceSourceRow = Pick<InterpretedTransaction, "id" | "dateIso" | "sourceFile"> &
  Partial<Pick<InterpretedTransaction, "accountId" | "accountKey" | "source">>;

/** AU bank CSV / statement cells that print a running or closing balance. */
export const STATED_BALANCE_HEADERS = [
  "closing balance",
  "running balance",
  "account balance",
  "balance",
] as const;

/**
 * The bank's printed balance on this row, when the file carried one.
 * Not Income − Spending, and not a period cashNet.
 */
export function statedBalanceFromSource(txn: BalanceSourceRow): number | null {
  for (const header of STATED_BALANCE_HEADERS) {
    const raw = sourceValue(txn.source, header);
    if (!raw.trim()) continue;
    const amount = parseBalanceAmount(raw);
    if (amount != null) return amount;
  }
  return null;
}

/**
 * Most recent stated balance per account in this set. Newest-first files (NAB,
 * Up) take the earliest row on the latest date; oldest-first files take the last.
 */
export function mostRecentStatedBalances(
  transactions: BalanceSourceRow[],
  mergedInto: Record<string, string> = {},
): Record<string, number> {
  const byAccount = new Map<string, Array<{ dateIso: string; index: number; amount: number }>>();
  for (const txn of transactions) {
    const amount = statedBalanceFromSource(txn);
    if (amount == null) continue;
    const id = accountIdForBalance(txn, mergedInto);
    const held = byAccount.get(id) ?? [];
    held.push({ dateIso: txn.dateIso, index: fileIndexOf(txn), amount });
    byAccount.set(id, held);
  }

  const next: Record<string, number> = {};
  for (const [id, rows] of byAccount) {
    const picked = pickMostRecentStatedBalance(rows);
    if (picked != null) next[id] = picked;
  }
  return next;
}

export function pickMostRecentStatedBalance(
  rows: Array<{ dateIso: string; index: number; amount: number }>,
): number | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => a.index - b.index);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const newestFirst = first.dateIso >= last.dateIso;
  let best = first;
  for (const row of ordered) {
    if (row.dateIso > best.dateIso) {
      best = row;
      continue;
    }
    if (row.dateIso !== best.dateIso) continue;
    if (newestFirst ? row.index < best.index : row.index > best.index) best = row;
  }
  return best.amount;
}

/**
 * Signed movement net for one account's estimate: every cleared row, including
 * transfer legs. PENDING stays out. Household Money in / Money out still exclude
 * transfers; this figure does not. Without a printed opening it is not a balance.
 */
export function derivedMovementBalance(transactions: InterpretedTransaction[]): number | null {
  const countable = transactions.filter((txn) => (txn.status ?? "CLEARED") !== "PENDING");
  if (countable.length === 0) return null;
  return roundMoney(countable.reduce((sum, txn) => sum + txn.amount, 0));
}

const BALANCE_RANK: Record<BalanceSource, number> = {
  fiskil: 1,
  running: 2,
  ofx_ledger: 3,
  header: 4,
  section: 4,
};

/** A stored balance with no source is treated as a running cell, not an estimate. */
export function effectiveBalanceSource(meta: AccountMeta | undefined): BalanceSource | undefined {
  if (meta?.balanceSource) return meta.balanceSource;
  if (typeof meta?.clearedBalance === "number" && Number.isFinite(meta.clearedBalance)) return "running";
  return undefined;
}

export function canReplaceBalance(
  existing: BalanceSource | undefined,
  incoming: BalanceSource,
): boolean {
  return BALANCE_RANK[incoming] >= (existing ? BALANCE_RANK[existing] : 0);
}

export type AccountBalanceView = {
  amount: number | null;
  source: BalanceSource | "estimated" | "missing_opening";
  label?: string;
  prompt?: string;
  warning?: string;
};

/**
 * Stated balance wins. Otherwise opening + every signed movement, labelled
 * estimated. With no opening, the figure is hidden.
 */
export function accountBalanceView(
  accountId: string,
  transactions: InterpretedTransaction[],
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): AccountBalanceView {
  const id = canonicalAccountId(accountId, mergedInto);
  const stored = meta[id]?.clearedBalance ?? meta[accountId]?.clearedBalance;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return {
      amount: stored,
      source: meta[id]?.balanceSource ?? meta[accountId]?.balanceSource ?? "running",
    };
  }
  const fromRows = mostRecentStatedBalances(transactions, mergedInto)[id];
  if (fromRows != null) {
    return { amount: fromRows, source: "running" };
  }
  const opening = meta[id]?.openingBalance ?? meta[accountId]?.openingBalance;
  if (opening == null) {
    return {
      amount: null,
      source: "missing_opening",
      label: NO_OPENING_BALANCE_LABEL,
      prompt: NO_OPENING_BALANCE_PROMPT,
    };
  }
  const net = derivedMovementBalance(transactions) ?? 0;
  return estimatedView(roundMoney(opening + net), id, meta);
}

function estimatedView(
  amount: number,
  accountId: string,
  meta: Record<string, AccountMeta>,
): AccountBalanceView {
  const kind = accountKindOf(accountId, meta);
  const warning =
    amount < 0 && (kind === "SAVINGS" || kind === "CHECKING") ? NEGATIVE_ESTIMATE_WARNING : undefined;
  return {
    amount,
    source: "estimated",
    label: ESTIMATED_BALANCE_LABEL,
    ...(warning ? { warning } : {}),
  };
}

function accountIdForBalance(txn: BalanceSourceRow, mergedInto: Record<string, string>): string {
  const raw = txn.accountId?.trim() || txn.accountKey?.trim();
  if (raw) return canonicalAccountId(raw, mergedInto);
  return canonicalAccountId(`Unknown source · ${txn.sourceFile}`, mergedInto);
}

/**
 * Row order in the original file.
 * CSV ids are `{sourceFile}-{index}-…`. Up and OFX insert `-up-` / `-ofx-`
 * before the index.
 */
export function fileIndexOf(txn: BalanceSourceRow): number {
  const marked = txn.id.match(/-(?:up|ofx)-(\d+)(?:-|$)/);
  if (marked) {
    const n = Number(marked[1]);
    return Number.isInteger(n) && n >= 0 ? n : Number.MAX_SAFE_INTEGER;
  }
  const prefix = `${txn.sourceFile}-`;
  if (!txn.id.startsWith(prefix)) return Number.MAX_SAFE_INTEGER;
  const n = Number(txn.id.slice(prefix.length).split("-")[0]);
  return Number.isInteger(n) && n >= 0 ? n : Number.MAX_SAFE_INTEGER;
}

function parseBalanceAmount(raw: string): number | null {
  const parsed = parseAmount(raw);
  if (parsed != null) return parsed;
  const text = raw.trim().replace(/,/g, "");
  if (/^\$?0+(?:\.0+)?$/.test(text)) return 0;
  return null;
}
