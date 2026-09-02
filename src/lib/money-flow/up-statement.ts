import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate, parseAmount } from "@/lib/money-flow/parse-values";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DATE_HEADER =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?$/i;
const TIME_LINE = /^(\d{1,2}:\d{2}\s*(?:am|pm))\s*(.*)$/i;
/** Each saver opens with its balances and is named at the end of that same line. */
const SAVER_HEADER = /Opening Balance:.*Closing Balance:\s*\$[\d,.]+\s*(.*)$/i;
/** Up's own name for the transaction account the savers transfer to and from. */
const SPENDING_ACCOUNT = "Spending";

export function looksLikeUpStatement(text: string): boolean {
  return (
    /up is a brand of bendigo/i.test(text) ||
    /zap card \*\*/i.test(text) ||
    /osko payment received/i.test(text)
  );
}

export function transactionsFromUpStatement(text: string, sourceFile: string): InterpretedTransaction[] {
  const latestYear = statementYear(text);
  const covers = statementRange(text);
  const normalized = text.replace(/\+\s*\n\s*\$/g, "+$").replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    // A saver's opening line is boilerplate everywhere else, but it is the only
    // place the statement says which saver the movements below it belong to.
    .filter((line) => !shouldSkip(line) || SAVER_HEADER.test(line));

  const results: InterpretedTransaction[] = [];
  let currentDate: string | null = null;
  let pending: string[] = [];
  // Day headings carry no year and run newest first, so the year steps back a
  // year each time the month climbs instead of falling.
  let year = latestYear;
  let previousMonth: number | null = null;
  let account = SPENDING_ACCOUNT;

  const flush = () => {
    const txn = transactionFromBlock(pending, currentDate, sourceFile, results.length, account);
    if (txn) results.push(txn);
    pending = [];
  };

  for (const line of lines) {
    // Each saver account restarts at the newest day, and names itself as it opens.
    const saver = line.match(SAVER_HEADER);
    if (saver) {
      flush();
      account = saver[1].trim() || account;
      year = latestYear;
      previousMonth = null;
      continue;
    }

    const header = line.match(DATE_HEADER);
    if (header) {
      flush();
      const month = MONTHS[header[3].toLowerCase()];
      if (month && previousMonth != null && month > previousMonth) year -= 1;
      if (month) previousMonth = month;

      const day = Number(header[2]);
      const inRange = withinRange(toIso(day, month, year), covers);
      if (!inRange) {
        // A heading the month rule mis-stepped on, rather than a movement from
        // outside the period the statement says it covers.
        const nudged = [year + 1, year - 1].find((candidate) => withinRange(toIso(day, month, candidate), covers));
        if (nudged) year = nudged;
      }
      currentDate = toIso(day, month, year);
      continue;
    }

    const timed = line.match(TIME_LINE);
    if (timed) {
      flush();
      pending = [line];
      if (moneyCount(line) >= 1) flush();
      continue;
    }

    if (pending.length > 0) {
      pending.push(line);
      if (isAmountLine(line)) flush();
    }
  }
  flush();

  return results;
}

type StatementRange = { from: string; to: string } | null;

/** "01 Jul 2025 to 30 Jun 2026", when the statement states what it covers. */
function statementRange(text: string): StatementRange {
  const match = text.match(
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})\s+to\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})/i,
  );
  if (!match) return null;
  const from = toIso(Number(match[1]), MONTHS[match[2].toLowerCase()], Number(match[3]));
  const to = toIso(Number(match[4]), MONTHS[match[5].toLowerCase()], Number(match[6]));
  return from && to ? { from, to } : null;
}

function withinRange(iso: string | null, covers: StatementRange): boolean {
  if (!iso) return false;
  if (!covers) return true;
  return iso >= covers.from && iso <= covers.to;
}

/** The year the newest movement falls in, which the day headings count back from. */
function statementYear(text: string): number {
  const range = text.match(
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+20\d{2}\s+to\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})/i,
  );
  if (range) return Number(range[1]);

  const single = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s+Statement/i,
  );
  return single ? Number(single[1]) : new Date().getFullYear();
}

function shouldSkip(line: string): boolean {
  return (
    /^\d+\s+of\s+\d+/i.test(line) ||
    /up\.com\.au/i.test(line) ||
    /this statement was generated/i.test(line) ||
    /please carefully check/i.test(line) ||
    /report apparent errors/i.test(line) ||
    /australian financial complaints/i.test(line) ||
    /for full conditions/i.test(line) ||
    /card and account security/i.test(line) ||
    /^ABN\b/i.test(line) ||
    /^BSB\b/i.test(line) ||
    /^Account\b/i.test(line) ||
    /^Summary$/i.test(line) ||
    /^Registered address:/i.test(line) ||
    /opening balance/i.test(line) ||
    /closing balance/i.test(line) ||
    /^Money In Money Out$/i.test(line) ||
    /^Savers$/i.test(line) ||
    /base interest rate/i.test(line) ||
    /no transactions during this period/i.test(line) ||
    /^Interest Rates$/i.test(line) ||
    /^Complaints$/i.test(line)
  );
}

function moneyMatches(text: string) {
  return [...text.matchAll(/([+-]?)\s*\$(\d{1,3}(?:,\d{3})*\.\d{2})/g)];
}

function moneyCount(line: string): number {
  return moneyMatches(line).length;
}

function isAmountLine(line: string): boolean {
  return (
    /zap card|up plastic|eftpos withdrawal|direct debit/i.test(line) ||
    moneyCount(line) >= 1
  );
}

function transactionFromBlock(
  lines: string[],
  dateIso: string | null,
  sourceFile: string,
  index: number,
  account: string,
): InterpretedTransaction | null {
  if (!dateIso || lines.length === 0) return null;
  const block = lines.join(" ");
  const amounts = moneyMatches(block)
    .map((match) => {
      const value = parseAmount(`${match[1]}$${match[2]}`);
      return { value, plus: match[1] === "+", minus: match[1] === "-" };
    })
    .filter((item): item is { value: number; plus: boolean; minus: boolean } => item.value != null);

  if (amounts.length === 0) return null;

  const txnAmount = amounts[0];
  const description = descriptionFrom(lines);
  if (!description) return null;

  const category = categorize(description);
  let amount = txnAmount.value;
  if (txnAmount.plus) amount = Math.abs(amount);
  else if (txnAmount.minus) amount = -Math.abs(amount);
  else amount = -Math.abs(amount);

  if (/\brefund\b/i.test(description)) amount = Math.abs(amount);
  if (/\bosko payment received|\binterest\b/i.test(description)) amount = Math.abs(amount);

  const type = inferType(description, amount, category);
  if (type === "income" || type === "refund") amount = Math.abs(amount);
  if (type === "expense" && amount > 0) amount = -amount;

  return {
    id: `${sourceFile}-up-${index}-${dateIso}-${amount}`,
    merchant: tidyMerchant(merchantFrom(lines, description)),
    category,
    date: formatDisplayDate(dateIso),
    dateIso,
    amount,
    type,
    sourceFile,
    accountId: account,
    confidence: 0.9,
  };
}

function merchantFrom(lines: string[], description: string): string {
  const timed = lines[0]?.match(TIME_LINE);
  const onTimeLine = timed?.[2]?.trim() ?? "";
  if (onTimeLine && !/^\$/.test(onTimeLine) && moneyCount(onTimeLine) === 0) {
    return onTimeLine.replace(/\b(purchase|refund|direct debit|eftpos withdrawal)$/i, "").trim() || onTimeLine;
  }
  const named = lines
    .slice(1)
    .map((line) => line.replace(TIME_LINE, "$2").trim())
    .find((line) => /[A-Za-z]{3,}/.test(line) && !isAmountLine(line) && !/, (NSW|VIC|QLD|ACT|SA|WA|TAS|NT)\b/i.test(line));
  return named || description;
}

function descriptionFrom(lines: string[]): string {
  return lines
    .join(" ")
    .replace(TIME_LINE, "$2 ")
    .replace(/zap card \*\*\d+/gi, " ")
    .replace(/up plastic \*\*\d+/gi, " ")
    .replace(/([+-]?)\s*\$(\d{1,3}(?:,\d{3})*\.\d{2})/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(day: number, month: number | undefined, year: number): string | null {
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
