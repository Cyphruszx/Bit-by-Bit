import { tidyMerchant } from "@/lib/money-flow/categorize";
import { readMovement } from "@/lib/money-flow/interpret-row";
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
  // A statement whose chain will not close is usually a good statement with one bad row —
  // a page break, a line the reader mangled. Every other row still sits beside a balance
  // that says which way its money went, so those are read and only the rest are guessed.
  const perRow = chained ? null : signByNeighbouringBalance(rows, opening);

  return rows.map((row, position) => {
    const fromBalance = chained?.[position] ?? perRow?.[position] ?? null;
    // A balance says which way the money went, and is believed over any reading of the
    // words. Without one the wording is all there is.
    const read =
      fromBalance != null
        ? readMovement(row.description, fromBalance, true)
        : readMovement(row.description, magnitudeOf(row), false);

    return {
      id: `${sourceFile}-line-${row.index}-${row.dateIso}`,
      merchant: tidyMerchant(row.description),
      categoryKey: read.categoryKey,
      decidedBy: read.decidedBy,
      date: formatDisplayDate(row.dateIso),
      dateIso: row.dateIso,
      amount: read.amount,
      type: read.type,
      sourceFile,
      // A balance the statement itself agrees with is stronger evidence than a guess at
      // which way an amount was meant to go; one neighbouring balance is weaker than a
      // whole chain that closed, and stronger than the wording alone.
      confidence: chained ? 0.92 : fromBalance != null ? 0.8 : 0.64,
    };
  });
}

/**
 * What a movement was, when no balance could be checked against it: the wording has to
 * say which way the money went.
 *
 * Which figure is the amount still matters. A line carrying two is a table with a balance
 * column whose chain would not close, and the balance is the last figure written — taking
 * it as the movement turns a $100 shop into $900 of income. What moved is the figure
 * before it.
 */
function magnitudeOf(row: Row): number {
  return row.amounts.length >= 2 ? magnitude(row) : row.amounts[0];
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

  // The chain needs somewhere to start, and only the statement can say where. Guessing the
  // opening from the first row cannot work: both guesses agree on every row after the
  // first and differ only on the first, and the closing balance cannot tell them apart
  // because a chain always lands on its own last balance whatever it started from. So a
  // statement that does not print its opening balance is read on its wording instead.
  if (opening == null) return null;

  const signed = walk(rows, opening);
  if (!signed) return null;

  // The statement's own closing balance is the last word on whether the walk was right.
  const ends = roundToCent(opening + signed.reduce((sum, value) => sum + value, 0));
  if (closing != null && Math.abs(ends - closing) > CENT) return null;

  return signed;
}

function roundToCent(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Each row against the balance beside the one before it. Where the two agree on what
 * moved, the difference says which way it went; where they do not, the row is left for
 * the wording. Unlike the chain this survives a single bad row, and unlike the chain it
 * proves nothing overall — so it is only ever the fallback.
 */
function signByNeighbouringBalance(rows: Row[], opening: number | null): (number | null)[] | null {
  if (!rows.every((row) => row.amounts.length >= 2)) return null;

  return rows.map((row, index) => {
    const before = index === 0 ? opening : last(rows[index - 1]);
    if (before == null) return null;
    const change = last(row) - before;
    return Math.abs(Math.abs(change) - magnitude(row)) > CENT ? null : roundToCent(change);
  });
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
        signed[index] = roundToCent(change);
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

