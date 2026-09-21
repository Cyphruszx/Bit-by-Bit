import { canonicalAccountId } from "@/lib/money-flow/account-identity";
import { parseAmount, roundMoney } from "@/lib/money-flow/parse-values";
import { sourceValue } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

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
export function statedBalanceFromSource(txn: InterpretedTransaction): number | null {
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
  transactions: InterpretedTransaction[],
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
 * When the file never printed a balance, derive one from signed movements
 * (credits − debits). PENDING rows stay out. Differs from Spec 10 Net.
 */
export function derivedMovementBalance(transactions: InterpretedTransaction[]): number | null {
  const rows = transactions.filter((txn) => (txn.status ?? "CLEARED") !== "PENDING");
  if (rows.length === 0) return null;
  return roundMoney(rows.reduce((sum, txn) => sum + txn.amount, 0));
}

function accountIdForBalance(txn: InterpretedTransaction, mergedInto: Record<string, string>): string {
  const raw = txn.accountId?.trim() || txn.accountKey?.trim();
  if (raw) return canonicalAccountId(raw, mergedInto);
  return canonicalAccountId(`Unknown source · ${txn.sourceFile}`, mergedInto);
}

/** Row order in the original file, encoded as `{sourceFile}-{index}-…` by the readers. */
function fileIndexOf(txn: InterpretedTransaction): number {
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
