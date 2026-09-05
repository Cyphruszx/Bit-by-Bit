import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { categoryFromBankLabel } from "@/lib/money-flow/statement-category";
import { inflowType, splitSuggestion, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { BankWords, DecidedBy, InterpretedTransaction, SourceRow, TransactionType } from "@/lib/money-flow/types";

export type RawMovement = {
  dateIso: string;
  amount: number;
  directionKnown: boolean;
  description: string;
  typeHint?: string;
  merchant?: string;
  bankCategory?: string;
  accountKey?: string;
  accountId?: string;
  source?: SourceRow;
  sourceFile: string;
  id: string;
  confidence: number;
};

export function signFromType(amount: number, type: TransactionType): number {
  if (inflowType(type)) return Math.abs(amount);
  return amount > 0 ? -amount : amount;
}

/**
 * Which way the money went, for a statement that gave an amount without a sign.
 *
 * Read before anything is categorised, because the category now depends on the direction
 * rather than the other way round: the same merchant means one thing on a payment and
 * another on a receipt, so the direction has to be settled first or the two swap places.
 */
const ARRIVING = /\b(refund|reversal|rebate|credit|received|deposit|salary|wage|payroll|benefits?)\b/i;

export function directionFromWords(text: string): 1 | -1 {
  // Interest both ways, and the word that separates them. "Interest charged" is a cost and
  // "Interest" on its own is a payment in, which is two of the sample statement's rows.
  if (/\binterest\b/i.test(text)) return /\bcharged?\b/i.test(text) ? -1 : 1;
  return ARRIVING.test(text) ? 1 : -1;
}

export type Reading = {
  /** Signed, so a negative amount is money leaving. */
  amount: number;
  categoryKey: string;
  /** The detail the rule knew, when it knew one. Groceries rather than just Food & Drink. */
  tag?: string;
  type: TransactionType;
  decidedBy: DecidedBy;
};

/**
 * The one place a movement's direction, category and type are decided, and the order they
 * have to be decided in.
 *
 * Direction first, because the category now depends on it — the same merchant means health
 * spending on a payment and a benefit on a receipt. Then the merchant rules, then the
 * bank's own label, and if neither has anything to say the movement is left unsorted
 * rather than dropped in a bucket.
 *
 * Every reader shares this. The three that used to keep their own copy each ran the same
 * three steps in the old order, so a fix to one of them fixed only that file's statements.
 */
export function readMovement(
  text: string,
  rawAmount: number,
  directionKnown: boolean,
  bankCategory?: string,
): Reading {
  const amount = directionKnown ? rawAmount : Math.abs(rawAmount) * directionFromWords(text);
  const fromRules = categorize(text, amount);
  const fromBank = fromRules ? null : categoryFromBankLabel(bankCategory, amount);
  // A rule says `food.groceries` because that is the legible way to write a rule. It means
  // a category and a tag, and this is where the two come apart.
  const { categoryKey, tag } = splitSuggestion(fromRules ?? fromBank ?? UNCATEGORISED);
  return {
    amount,
    categoryKey,
    ...(tag ? { tag } : {}),
    type: inferType(categoryKey, amount),
    decidedBy: fromRules ? "rules" : fromBank ? "bank" : "unreviewed",
  };
}

export function interpretMovement(raw: RawMovement): InterpretedTransaction {
  const bank: BankWords = {
    ...(raw.bankCategory?.trim() ? { category: raw.bankCategory.trim() } : {}),
    ...(raw.typeHint?.trim() ? { type: raw.typeHint.trim() } : {}),
    ...(raw.merchant?.trim() ? { merchant: raw.merchant.trim() } : {}),
  };
  const text = [bank.merchant, raw.description, bank.type, bank.category].filter(Boolean).join(" ");
  const read = readMovement(text, raw.amount, raw.directionKnown, bank.category);

  const accountKey = raw.accountKey?.trim();
  const accountId = raw.accountId?.trim();

  return {
    id: raw.id,
    merchant: tidyMerchant(bank.merchant || raw.description),
    categoryKey: read.categoryKey,
    ...(read.tag ? { tags: [read.tag] } : {}),
    decidedBy: read.decidedBy,
    extractedBy: "parser",
    date: formatDisplayDate(raw.dateIso),
    dateIso: raw.dateIso,
    amount: read.amount,
    type: read.type,
    sourceFile: raw.sourceFile,
    ...(Object.keys(bank).length > 0 ? { bank } : {}),
    ...(accountKey ? { accountKey } : {}),
    ...(accountId ? { accountId } : {}),
    ...(raw.source ? { source: raw.source } : {}),
    ...(raw.description.trim() ? { description: raw.description.trim() } : {}),
    confidence: raw.confidence,
  };
}
