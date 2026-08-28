import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate, parseAmount, parseDate } from "@/lib/money-flow/parse-values";
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

export function transactionsFromTable(rows: Array<Array<string | number | null>>, sourceFile: string): InterpretedTransaction[] {
  if (rows.length === 0) return [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => typeof cell === "string" && looksLikeHeader(String(cell))));
  const start = headerIndex >= 0 ? headerIndex : 0;
  const headers = (rows[start] ?? []).map((cell) => String(cell ?? ""));
  const body = rows.slice(start + (headerIndex >= 0 ? 1 : 0));

  const dateIdx = findColumn(headers, DATE_HEADERS);
  const amountIdx = findColumn(headers, AMOUNT_HEADERS);
  const debitIdx = findColumn(headers, DEBIT_HEADERS);
  const creditIdx = findColumn(headers, CREDIT_HEADERS);
  const typeIdx = findColumn(headers, TYPE_HEADERS);

  const results: InterpretedTransaction[] = [];
  body.forEach((row, index) => {
    const cells = row.map((cell) => (cell == null ? "" : String(cell)));
    if (cells.every((cell) => !cell.trim())) return;

    const dateIso = parseDate(dateIdx >= 0 ? cells[dateIdx] : firstDateCell(cells));
    const description = descriptionFrom(headers, cells, dateIdx);
    const typeHint = typeIdx >= 0 ? cells[typeIdx] : "";
    let amount: number | null = null;

    if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = debitIdx >= 0 ? parseAmount(cells[debitIdx]) : null;
      const credit = creditIdx >= 0 ? parseAmount(cells[creditIdx]) : null;
      if (credit != null || debit != null) {
        amount = (credit ?? 0) - Math.abs(debit ?? 0);
      }
    }
    if (amount == null && amountIdx >= 0) {
      amount = parseAmount(`${cells[amountIdx]} ${typeHint}`.trim());
    }
    if (amount == null) {
      amount = lastAmountCell(cells);
    }
    if (amount == null || !dateIso || !description) return;
    if (isSummaryRow(description) && Math.abs(amount) > 0 && cells.length <= 3) {
      return;
    }

    const category = categorize(`${description} ${typeHint}`);
    const type = inferType(`${description} ${typeHint}`, amount, category);
    const signed = type === "income" || type === "refund" ? Math.abs(amount) : type === "transfer" ? -Math.abs(amount) : amount > 0 && type === "expense" ? -amount : amount;

    results.push({
      id: `${sourceFile}-${index}-${dateIso}-${amount}`,
      merchant: tidyMerchant(description),
      category,
      date: formatDisplayDate(dateIso),
      dateIso,
      amount: signed === 0 ? amount : signed,
      type,
      sourceFile,
      confidence: headerIndex >= 0 ? 0.92 : 0.7,
    });
  });

  return results;
}

function descriptionFrom(headers: string[], cells: string[], dateIdx: number): string {
  const parts = DESC_HEADERS.map((header) => findColumn(headers, [header]))
    .filter((index, position, all) => index >= 0 && all.indexOf(index) === position)
    .map((index) => cells[index]?.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return longestTextCell(cells, dateIdx);
}

function looksLikeHeader(cell: string): boolean {
  const value = norm(cell);
  return [...DATE_HEADERS, ...DESC_HEADERS, ...AMOUNT_HEADERS, ...DEBIT_HEADERS, ...CREDIT_HEADERS].some(
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
    const amount = parseAmount(cells[i]);
    if (amount != null) return amount;
  }
  return null;
}

function isSummaryRow(description: string): boolean {
  return /^(opening( balance)?|closing( balance)?|balance|total)$/i.test(description.trim());
}
