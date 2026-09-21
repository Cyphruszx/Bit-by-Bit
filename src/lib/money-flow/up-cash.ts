import { sourceValue } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * Up as the existing institution identity stamps it: detectInstitution label
 * "Up" (filename `\bup\b`, statement branding, or Up CSV headers) and
 * identifyAccounts' `Up · …` keys.
 */
export function isUpMovement(txn: InterpretedTransaction): boolean {
  if (txn.institution?.trim() === "Up") return true;
  const account = txn.accountId?.trim() ?? "";
  return account === "Up" || account.startsWith("Up · ");
}

/** The bank's Transaction Type cell, not the interpretive `txn.type`. */
export function upBankTransactionType(txn: InterpretedTransaction): string {
  const fromBank = txn.bank?.type?.trim();
  if (fromBank) return fromBank;
  return (
    sourceValue(txn.source, "Transaction Type").trim() || sourceValue(txn.source, "Type").trim()
  );
}

/**
 * Up CSV / Up-shaped ingest: Transaction Type is exactly "Transfer"
 * (Spending ↔ savers), case-insensitive. Blank or missing type is included.
 * Not NAB `TRANSFER DEBIT`, not Payment / BPAY / Direct Debit / Purchase.
 * Other banks are never filtered here.
 */
export function isUpTransferType(txn: InterpretedTransaction): boolean {
  if (!isUpMovement(txn)) return false;
  const type = upBankTransactionType(txn);
  if (!type) return false;
  return type.toLowerCase() === "transfer";
}

export function excludingUpTransfers(transactions: InterpretedTransaction[]): InterpretedTransaction[] {
  return transactions.filter((txn) => !isUpTransferType(txn));
}
