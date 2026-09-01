import { interpretMovement } from "@/lib/money-flow/interpret-row";
import { parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import { tableInterpretationNotes } from "@/lib/money-flow/statement-category";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const DATE_HEADERS = ["date", "transaction date", "txn date", "posted", "value date", "processed", "trans date"];
const DESC_HEADERS = [
  "description",
  "details",
  "narrative",
  "merchant",
  "particulars",
  "memo",
  "name",
  "transaction",
  "payee",
  "reference",
];
const AMOUNT_HEADERS = ["amount", "value", "transaction amount", "aud", "nzd", "usd", "transaction amt"];
const DEBIT_HEADERS = ["debit", "debit amount", "withdrawal", "money out", "spent", "payments"];
const CREDIT_HEADERS = ["credit", "credit amount", "deposit", "money in", "received", "receipts"];
const TYPE_HEADERS = ["type", "transaction type", "dr/cr", "debit/credit"];
const MERCHANT_HEADERS = ["merchant name", "merchant", "payee"];
const CATEGORY_HEADERS = ["category", "nab category", "bank category"];
const ACCOUNT_HEADERS = ["account number", "account no", "account", "acct", "bsb account number", "card number"];

const MONEY_CELL = /^[-+(]?\s*\$?\s*\d[\d,]*(\.\d{1,2})?\s*\)?-?$/;

function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(norm);
  for (const candidate of candidates) {
    const index = normalized.findIndex((header) => header === candidate || header.includes(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const counts: Array<[string, number]> = [
    [",", (sample.match(/,/g) ?? []).length],
    [";", (sample.match(/;/g) ?? []).length],
    ["\t", (sample.match(/\t/g) ?? []).length],
    ["|", (sample.match(/\|/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function rowsFromCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  return parseDelimited(text.replace(/^\uFEFF/, ""), delimiter);
}

export function interpretTable(
  rows: Array<Array<string | number | null>>,
  sourceFile: string,
): { transactions: InterpretedTransaction[]; notes: string[] } {
  if (rows.length === 0) return { transactions: [], notes: [] };
  const headerIndex = rows.findIndex((row) => row.some((cell) => typeof cell === "string" && looksLikeHeader(String(cell))));
  const start = headerIndex >= 0 ? headerIndex : 0;
  const headers = (rows[start] ?? []).map((cell) => String(cell ?? ""));
  const body = rows.slice(start + (headerIndex >= 0 ? 1 : 0));

  const dateIdx = findColumn(headers, DATE_HEADERS);
  const amountIdx = findColumn(headers, AMOUNT_HEADERS);
  const debitIdx = findColumn(headers, DEBIT_HEADERS);
  const creditIdx = findColumn(headers, CREDIT_HEADERS);
  const typeIdx = findColumn(headers, TYPE_HEADERS);
  const merchantIdx = findColumn(headers, MERCHANT_HEADERS);
  const categoryIdx = findColumn(headers, CATEGORY_HEADERS);
  const accountIdx = findColumn(headers, ACCOUNT_HEADERS);
  const claimed = [dateIdx, amountIdx, debitIdx, creditIdx, typeIdx, merchantIdx, categoryIdx, accountIdx];

  const results: InterpretedTransaction[] = [];
  body.forEach((row, index) => {
    const cells = row.map((cell) => (cell == null ? "" : String(cell)));
    if (cells.every((cell) => !cell.trim())) return;

    const dateIso = parseDate(dateIdx >= 0 ? cells[dateIdx] : firstDateCell(cells));
    const description = descriptionFrom(headers, cells, claimed, dateIdx);
    const typeHint = typeIdx >= 0 ? cells[typeIdx] : "";
    const amountCell = amountIdx >= 0 ? (cells[amountIdx] ?? "").trim() : "";
    let amount: number | null = null;
    let directionKnown = false;

    if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = debitIdx >= 0 ? parseAmount(cells[debitIdx]) : null;
      const credit = creditIdx >= 0 ? parseAmount(cells[creditIdx]) : null;
      if (credit != null || debit != null) {
        amount = (credit ?? 0) - Math.abs(debit ?? 0);
        directionKnown = true;
      }
    }
    if (amount == null && amountCell) {
      const parsed = parseAmount(amountCell);
      if (parsed == null) return;
      const direction = directionFrom(typeHint);
      amount = parsed > 0 && direction < 0 ? -parsed : parsed;
      directionKnown = parsed < 0 || direction !== 0;
    }
    if (amount == null) {
      amount = lastAmountCell(cells);
    }
    if (amount == null || !dateIso || !description) return;
    if (/\b(balance|opening|closing|total)\b/i.test(description) && Math.abs(amount) > 0 && cells.length <= 3) {
      return;
    }

    results.push(
      interpretMovement({
        dateIso,
        amount,
        directionKnown,
        description,
        typeHint,
        merchant: merchantIdx >= 0 ? cells[merchantIdx] : "",
        bankCategory: categoryIdx >= 0 ? cells[categoryIdx] : "",
        accountKey: accountIdx >= 0 ? cells[accountIdx] : "",
        sourceFile,
        id: `${sourceFile}-${index}-${dateIso}-${amount}`,
        confidence: headerIndex >= 0 ? 0.92 : 0.7,
      }),
    );
  });

  return { transactions: results, notes: tableInterpretationNotes(headers) };
}

export function transactionsFromTable(
  rows: Array<Array<string | number | null>>,
  sourceFile: string,
): InterpretedTransaction[] {
  return interpretTable(rows, sourceFile).transactions;
}

function directionFrom(typeHint: string): number {
  if (/\b(cr|credit|deposit)\b/i.test(typeHint)) return 1;
  if (/\b(dr|debit|withdrawal)\b/i.test(typeHint)) return -1;
  return 0;
}

function descriptionFrom(headers: string[], cells: string[], claimed: number[], dateIdx: number): string {
  const parts = DESC_HEADERS.map((header) => findColumn(headers, [header]))
    .filter((index, position, all) => index >= 0 && !claimed.includes(index) && all.indexOf(index) === position)
    .map((index) => cells[index]?.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return longestTextCell(cells, dateIdx);
}

function looksLikeHeader(cell: string): boolean {
  const value = norm(cell);
  return [...DATE_HEADERS, ...DESC_HEADERS, ...AMOUNT_HEADERS, ...DEBIT_HEADERS, ...CREDIT_HEADERS, ...TYPE_HEADERS, ...CATEGORY_HEADERS].some(
    (header) => value === header || value.includes(header),
  );
}

function firstDateCell(cells: string[]): string {
  return cells.find((cell) => parseDate(cell)) ?? "";
}

function longestTextCell(cells: string[], skip: number): string {
  return cells
    .filter((_, index) => index !== skip)
    .filter((cell) => /[A-Za-z]/.test(cell) && parseAmount(cell) == null)
    .sort((a, b) => b.length - a.length)[0] ?? cells.join(" ");
}

function lastAmountCell(cells: string[]): number | null {
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    if (!MONEY_CELL.test(cells[i].trim())) continue;
    const amount = parseAmount(cells[i]);
    if (amount != null) return amount;
  }
  return null;
}
