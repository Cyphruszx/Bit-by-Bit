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

export function looksLikeUpStatement(text: string): boolean {
  return (
    /up is a brand of bendigo/i.test(text) ||
    /zap card \*\*/i.test(text) ||
    /osko payment received/i.test(text)
  );
}

export function transactionsFromUpStatement(text: string, sourceFile: string): InterpretedTransaction[] {
  const year = statementYear(text);
  const normalized = text.replace(/\+\s*\n\s*\$/g, "+$").replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !shouldSkip(line));

  const results: InterpretedTransaction[] = [];
  let currentDate: string | null = null;
  let pending: string[] = [];

  const flush = () => {
    const txn = transactionFromBlock(pending, currentDate, sourceFile, results.length);
    if (txn) results.push(txn);
    pending = [];
  };

  for (const line of lines) {
    const header = line.match(DATE_HEADER);
    if (header) {
      flush();
      currentDate = toIso(Number(header[2]), MONTHS[header[3].toLowerCase()], year);
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

function statementYear(text: string): number {
  const match = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s+Statement/i,
  );
  return match ? Number(match[1]) : new Date().getFullYear();
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
