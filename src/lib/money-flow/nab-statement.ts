import type { RawMovement } from "@/lib/money-flow/interpret-row";
import { parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import { normalizeHeader, sourceFromCells } from "@/lib/money-flow/source";

/**
 * The columns a NAB account export prints. Looked up by these names rather than
 * the pooled header vocabularies, so "Processed On" cannot steal the date and
 * "Merchant Name" cannot steal the description.
 */
const DATE = "Date";
const AMOUNT = "Amount";
const ACCOUNT = "Account Number";
const TYPE = "Transaction Type";
const DETAILS = "Transaction Details";
const CATEGORY = "Category";
const MERCHANT = "Merchant Name";

export function looksLikeNabExport(headers: string[]): boolean {
  const normalized = headers.map(normalizeHeader);
  const has = (name: string) => normalized.some((header) => header === name || header.includes(name));
  return has("merchant name") && has("transaction type") && has("category");
}

export function movementsFromNabTable(
  headers: string[],
  rows: Array<Array<string | number | null>>,
  sourceFile: string,
): RawMovement[] {
  const dateIdx = namedColumn(headers, DATE);
  const amountIdx = namedColumn(headers, AMOUNT);
  const accountIdx = namedColumn(headers, ACCOUNT);
  const typeIdx = namedColumn(headers, TYPE);
  const detailsIdx = namedColumn(headers, DETAILS);
  const categoryIdx = namedColumn(headers, CATEGORY);
  const merchantIdx = namedColumn(headers, MERCHANT);

  const movements: RawMovement[] = [];
  rows.forEach((row, index) => {
    const cells = row.map((cell) => (cell == null ? "" : String(cell)));
    if (cells.every((cell) => !cell.trim())) return;

    const dateIso = parseDate(dateIdx >= 0 ? cells[dateIdx] : "");
    const amount = parseAmount(amountIdx >= 0 ? cells[amountIdx] : "");
    const description = detailsIdx >= 0 ? cells[detailsIdx]?.trim() ?? "" : "";
    if (!dateIso || amount == null || !description) return;

    movements.push({
      dateIso,
      amount,
      directionKnown: true,
      description,
      typeHint: typeIdx >= 0 ? cells[typeIdx] : "",
      merchant: merchantIdx >= 0 ? cells[merchantIdx] : "",
      bankCategory: categoryIdx >= 0 ? cells[categoryIdx] : "",
      accountKey: accountIdx >= 0 ? cells[accountIdx] : "",
      source: sourceFromCells(headers, cells),
      sourceFile,
      id: `${sourceFile}-${index}-${dateIso}-${amount}`,
      confidence: 0.92,
    });
  });
  return movements;
}

function namedColumn(headers: string[], name: string): number {
  const needle = normalizeHeader(name);
  return headers.findIndex((header) => normalizeHeader(header) === needle);
}
