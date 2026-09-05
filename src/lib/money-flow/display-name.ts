import { sourceValue } from "@/lib/money-flow/source";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const TIME_LINE = /^(\d{1,2}:\d{2}\s*(?:am|pm))\s*(.*)$/i;

type Named = Pick<InterpretedTransaction, "merchant" | "description" | "bank" | "source">;

/**
 * The name the statement printed, not a title-cased copy.
 *
 * NAB puts a shop in Merchant Name and a payee in Transaction Details. Up puts a
 * shop on the time line, and for Osko / Payment / Direct Credit prints the
 * counterparty on the next line in front of that same type. Showing the rail
 * ("Osko Payment Received") or "Kfc" is the app talking, not the bank.
 */
export function displayName(txn: Named): string {
  const merchantName = collapse(sourceValue(txn.source, "Merchant Name"));
  if (merchantName) return merchantName;

  const lines = sourceValue(txn.source, "Lines");
  if (lines) {
    const fromLines = nameFromPrintedLines(lines.split(/\n/));
    if (fromLines) return fromLines;
  }

  const details = collapse(
    sourceValue(txn.source, "Transaction Details") || sourceValue(txn.source, "Description"),
  );
  if (details) return details;

  return collapse(txn.bank?.merchant || txn.merchant || txn.description || "") || "Unknown";
}

/** The printed name inside an Up block, including the counterparty when the bank wrote one. */
export function nameFromPrintedLines(lines: string[]): string {
  const raw = lines.map((line) => line.trim()).filter(Boolean);
  if (raw.length === 0) return "";

  const timed = raw[0].match(TIME_LINE);
  const onTimeLine = collapse(stripMoney(timed?.[2] ?? raw[0]));
  const headline = onTimeLine.replace(/\b(purchase|refund|direct debit|eftpos withdrawal)$/i, "").trim();

  const next = collapse(stripMoney((raw[1] ?? "").replace(TIME_LINE, "$2")));
  if (headline && next) {
    const cut = counterpartyBefore(next, headline);
    if (cut) return cut;
  }

  return headline || next;
}

function counterpartyBefore(next: string, headline: string): string {
  const escaped = headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cut = next.replace(new RegExp(`(?:\\s+${escaped})+$`, "i"), "").trim();
  return cut && cut !== next ? cut : "";
}

function stripMoney(text: string): string {
  return text.replace(/([+-]?)\s*\$(\d{1,3}(?:,\d{3})*\.\d{2})/g, " ").replace(/\s+[+-]\s*$/g, " ");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
