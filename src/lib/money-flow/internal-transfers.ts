/**
 * Internal transfers for Transactions Money in / Money out.
 *
 * Tiles filter on classification, not a payee denylist:
 *   - Spec 3 TRANSFER kind (including stored `moved`) — every TRANSFER
 *   - a proved `transferPair`
 *
 * Classify paths (ingest + ledger upgrade) stamp TRANSFER:
 *   - bank Transaction Type Transfer / XFER (Up CSV; OFX XFER)
 *   - Up OFX DEBIT/CREDIT whose NAME is a known pocket (CashFlow, …)
 *
 * NAB `TRANSFER DEBIT` is not this: it stays in cash until pairing / Review
 * writes TRANSFER. Blank / unknown type stays in unless classified TRANSFER.
 */

import { isProtectedAuthority, isTransferKind } from "@/lib/money-flow/movement-kind";
import { sourceValue } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * Up pockets that appear as OFX NAME on Spending ↔ saver moves.
 * Documented Up OFX heuristic — CSV already labels these Transaction Type=Transfer.
 */
export const UP_OFX_POCKET_NAMES = [
  "Spending",
  "CashFlow",
  "Essentials",
  "Investing",
  "Emergency Fund",
  "Presents",
  "Tax",
  "Save!!",
] as const;

const UP_OFX_POCKET_KEYS = new Set(UP_OFX_POCKET_NAMES.map(pocketKey));

export function isUpMovement(txn: InterpretedTransaction): boolean {
  if (txn.institution?.trim() === "Up") return true;
  const account = txn.accountId?.trim() ?? "";
  return account === "Up" || account.startsWith("Up · ");
}

/** The bank's type cell, not interpretive `txn.type`. */
export function bankTransactionType(txn: InterpretedTransaction): string {
  const fromBank = txn.bank?.type?.trim();
  if (fromBank) return fromBank;
  return (
    sourceValue(txn.source, "Transaction Type").trim() || sourceValue(txn.source, "Type").trim()
  );
}

/**
 * Bank type is the word Transfer (or OFX XFER). Not NAB `TRANSFER DEBIT`,
 * not Payment / BPAY / Direct Debit / Purchase. Blank is included in cash.
 */
export function isBankTransferType(txn: InterpretedTransaction): boolean {
  const type = bankTransactionType(txn);
  if (!type) return false;
  return /^(transfers?|xfer)$/i.test(type);
}

/** Up OFX: DEBIT/CREDIT whose NAME is a known pocket, not an external payee. */
export function isUpOfxPocketTransfer(txn: InterpretedTransaction): boolean {
  if (!isUpMovement(txn)) return false;
  const kind = bankTransactionType(txn);
  if (!/^(debit|credit)$/i.test(kind)) return false;
  const name = sourceValue(txn.source, "Name").trim() || txn.merchant.trim();
  return isUpOfxPocketName(name);
}

export function isUpOfxPocketName(name: string): boolean {
  return UP_OFX_POCKET_KEYS.has(pocketKey(name));
}

/**
 * Classified internal transfer: omit from Money in / Money out and from the
 * credits−debits Account balance fallback. Income / Spending / Net use
 * countedMovements and are unchanged. Pocket names are not consulted here —
 * they become TRANSFER at ingest / upgrade, then this filter sees the kind.
 */
export function isInternalTransfer(txn: InterpretedTransaction): boolean {
  return isTransferKind(txn.type) || Boolean(txn.transferPair);
}

export function excludingInternalTransfers(
  transactions: InterpretedTransaction[],
): InterpretedTransaction[] {
  return transactions.filter((txn) => !isInternalTransfer(txn));
}

/**
 * Stamp Up CSV Transfer and Up OFX pocket DEBIT/CREDIT as TRANSFER once the
 * institution is known. Does not overwrite a person-settled row.
 */
export function classifyKnownInternalTransfers(
  transactions: InterpretedTransaction[],
): InterpretedTransaction[] {
  return transactions.map(classifyKnownInternalTransfer);
}

export function classifyKnownInternalTransfer(txn: InterpretedTransaction): InterpretedTransaction {
  if (isProtectedAuthority(txn.decidedBy)) return txn;
  if (isTransferKind(txn.type)) return txn;
  if (isBankTransferType(txn) || isUpOfxPocketTransfer(txn)) {
    return { ...txn, type: "TRANSFER" };
  }
  return txn;
}

function pocketKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "").trim();
}
