import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate, parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{8})/;
const AMOUNT_PATTERN =
  /([+-]?\(?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})|\(?\$?\d+\.\d{2}\)?)\s*(CR|DR|Cr|Dr|credit|debit)?/g;

/**
 * Lines that describe the statement rather than anything that happened. A total printed
 * at the foot of a page is not money moving, and reading it as a movement both invents
 * income and dates it to the day the statement was printed.
 */
const NOT_A_MOVEMENT =
  /\b(opening balance|closing balance|account number|account type|account balance summary|bsb|page \d+|total (debits|credits)|transaction (listing|details)|date created|statement period)\b/i;

const OPENING_BALANCE = /\bopening balance\b[^\d-]*(-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(CR|DR)?/i;
const CLOSING_BALANCE = /\bclosing balance\b[^\d-]*(-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(CR|DR)?/i;

/** Money is equal to the cent and no finer, so a chain is allowed to land within one. */
const CENT = 0.005;

type Row = {
  index: number;
  dateIso: string;
  description: string;
  /** Every money figure on the line, in the order it was written. */
  amounts: number[];
};

export function transactionsFromText(text: string, sourceFile: string): InterpretedTransaction[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows: Row[] = [];
  let rollingDate: string | null = null;
  let opening: number | null = null;
  let closing: number | null = null;

  lines.forEach((line, index) => {
    // Read the summary before skipping it: an opening balance is not a movement, but it
    // is what says which way the first movement went.
    opening ??= balanceIn(line, OPENING_BALANCE);
    closing ??= balanceIn(line, CLOSING_BALANCE);
    if (NOT_A_MOVEMENT.test(line)) return;

    const dateMatch = line.match(DATE_PATTERN);
    if (dateMatch) {
      const parsed = parseDate(dateMatch[1]);
      if (parsed) rollingDate = parsed;
    }

    const found = [...line.matchAll(AMOUNT_PATTERN)]
      .map((match) => ({ value: parseAmount(`${match[1]} ${match[2] ?? ""}`), raw: match[0] }))
      .filter((item): item is { value: number; raw: string } => item.value != null);

    if (found.length === 0) return;
    const dateIso = rollingDate ?? parseDate(line);
    if (!dateIso) return;

    let description = line.replace(dateMatch?.[0] ?? "", "");
    for (const item of found) description = description.replace(item.raw, " ");
    description = description.replace(/[|•·]+/g, " ").replace(/\s+/g, " ").trim();
    if (!description || description.length < 3) return;
    if (parseAmount(description) != null && !/[A-Za-z]/.test(description)) return;

    rows.push({ index, dateIso, description, amounts: found.map((item) => item.value) });
  });

  const chained = signByRunningBalance(rows, opening, closing);

  return rows.map((row, position) => {
    const category = categorize(row.description);
    const amount = chained?.[position] ?? readWithoutBalance(row);
    const type = inferType(row.description, amount, category);

    return {
      id: `${sourceFile}-line-${row.index}-${row.dateIso}`,
      merchant: tidyMerchant(row.description),
      category,
      date: formatDisplayDate(row.dateIso),
      dateIso: row.dateIso,
      amount,
      type,
      sourceFile,
      // A balance the statement itself agrees with is stronger evidence than a guess at
      // which way an amount was meant to go.
      confidence: chained ? 0.92 : 0.64,
    };
  });
}

/**
 * What a movement was, when the line carries no balance to check it against: the last
 * figure is the amount, and the wording has to say which way it went.
 */
function readWithoutBalance(row: Row): number {
  const amount = row.amounts[row.amounts.length - 1];
  const type = inferType(row.description, amount, categorize(row.description));
  if (type === "income" || type === "refund") return Math.abs(amount);
  return type === "expense" && amount > 0 ? -amount : amount;
}

/**
 * Recovers each movement and the way it went from the running balance beside it.
 *
 * A statement printed with Debits, Credits and Balance columns loses the column an amount
 * sat in the moment it becomes text — every row reads "$297.90 $3,268.51" whether the
 * money came or went. But the balance says: a row that took the balance up was money in,
 * and one that took it down was money out.
 *
 * Rows within a day do not always come out of a PDF in the order they happened, so the
 * chain is walked rather than read straight down: at each step, the next row is whichever
 * unclaimed one connects to the balance so far. A chain that cannot be completed is no
 * chain at all, and the reader falls back to the wording rather than half-trusting it.
 */
function signByRunningBalance(rows: Row[], opening: number | null, closing: number | null): number[] | null {
  const withBalance = rows.every((row) => row.amounts.length >= 2);
  if (!withBalance || rows.length < 3) return null;

  // Without a stated opening balance, the first row's own two readings are the only two
  // places the chain can start, so both are tried.
  const first = rows[0];
  const seeds =
    opening != null
      ? [opening]
      : [last(first) - magnitude(first), last(first) + magnitude(first)];

  for (const seed of seeds) {
    const signed = walk(rows, seed);
    if (!signed) continue;
    // The statement's own closing balance is the last word on whether the walk was right.
    if (closing != null && Math.abs(seed + signed.reduce((sum, value) => sum + value, 0) - closing) > CENT) {
      continue;
    }
    return signed;
  }

  return null;
}

function walk(rows: Row[], opening: number): number[] | null {
  const signed = new Array<number>(rows.length);
  let balance = opening;
  let at = 0;

  while (at < rows.length) {
    // Only rows sharing a date can have come out in the wrong order, so the search for
    // the next link never reaches past the day being settled.
    const day = rows[at].dateIso;
    let end = at;
    while (end < rows.length && rows[end].dateIso === day) end += 1;

    const pending = new Set<number>();
    for (let index = at; index < end; index += 1) pending.add(index);

    while (pending.size > 0) {
      let took = -1;
      for (const index of pending) {
        const row = rows[index];
        const change = last(row) - balance;
        if (Math.abs(Math.abs(change) - magnitude(row)) > CENT) continue;
        signed[index] = round(change);
        balance = last(row);
        took = index;
        break;
      }
      if (took < 0) return null;
      pending.delete(took);
    }

    at = end;
  }

  return signed;
}

/** The balance a row leaves behind: the last figure written on the line. */
function last(row: Row): number {
  return row.amounts[row.amounts.length - 1];
}

/** What moved, which is whichever figure is not the balance. */
function magnitude(row: Row): number {
  return Math.abs(row.amounts[row.amounts.length - 2]);
}

function balanceIn(line: string, pattern: RegExp): number | null {
  const match = line.match(pattern);
  if (!match) return null;
  const value = parseAmount(match[1]);
  if (value == null) return null;
  return match[2]?.toUpperCase() === "DR" ? -Math.abs(value) : Math.abs(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
