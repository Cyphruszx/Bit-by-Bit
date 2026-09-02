import {
  institutionOf,
  UNKNOWN_INSTITUTION,
  withInstitution,
  type InstitutionOverrides,
} from "@/lib/money-flow/institution";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

/** Reads as one account per statement until a reader can do better. */
export const UNNAMED_ACCOUNT = "Unnamed account";

const SEPARATOR = " · ";

export type AccountTotals = {
  id: string;
  /** The account as a person would say it, with long numbers shortened. */
  label: string;
  institution: string;
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
};

/**
 * Names the bank and the account on every movement a document produced. The parser
 * supplies whichever of the two it could see — a saver's name, an account number —
 * and this puts them together so two banks using 100200300 never read as one account.
 */
export function identifyAccounts(
  transactions: InterpretedTransaction[],
  institution: string | undefined,
): InterpretedTransaction[] {
  return withInstitution(transactions, institution).map((txn) => {
    const within = txn.accountId?.trim() || txn.accountKey?.trim() || "";
    const id = [institution?.trim(), within].filter(Boolean).join(SEPARATOR);
    return id ? { ...txn, accountId: id } : txn;
  });
}

/** A movement always belongs to some account, even when the statement named none. */
export function accountIdOf(txn: InterpretedTransaction, overrides: InstitutionOverrides = {}): string {
  const named = txn.accountId?.trim();
  if (named) return named;
  const institution = institutionOf(txn, overrides);
  return institution === UNKNOWN_INSTITUTION ? txn.sourceFile : institution;
}

/** "NAB · 100200300" reads as "NAB · ···300", because the digits are not the point. */
export function accountLabel(id: string): string {
  return id
    .split(SEPARATOR)
    .map((part) => (/^\d{6,}$/.test(part) ? `···${part.slice(-3)}` : part))
    .join(SEPARATOR);
}

export function accountsFrom(
  transactions: InterpretedTransaction[],
  overrides: InstitutionOverrides = {},
): AccountTotals[] {
  const grouped = new Map<string, InterpretedTransaction[]>();
  for (const txn of transactions) {
    const id = accountIdOf(txn, overrides);
    const rows = grouped.get(id) ?? [];
    rows.push(txn);
    grouped.set(id, rows);
  }

  return [...grouped.entries()].map(([id, rows]) => ({
    id,
    label: accountLabel(id),
    institution: institutionOf(rows[0], overrides),
    transactions: rows,
    flow: summarizeMoneyFlow(rows),
  }));
}
