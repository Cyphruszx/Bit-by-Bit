import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { tagFromBankCategory } from "@/lib/money-flow/statement-category";
import type { InterpretedTransaction, TransactionType } from "@/lib/money-flow/types";

export type RawMovement = {
  dateIso: string;
  amount: number;
  directionKnown: boolean;
  description: string;
  typeHint?: string;
  merchant?: string;
  bankCategory?: string;
  sourceFile: string;
  id: string;
  confidence: number;
};

export function signFromType(amount: number, type: TransactionType): number {
  if (type === "income" || type === "refund") return Math.abs(amount);
  if (type === "transfer") return -Math.abs(amount);
  return type === "expense" && amount > 0 ? -amount : amount;
}

export function interpretMovement(raw: RawMovement): InterpretedTransaction {
  const bankCategory = raw.bankCategory?.trim() ?? "";
  const typeHint = raw.typeHint?.trim() ?? "";
  const merchantLabel = raw.merchant?.trim() ?? "";
  const text = [merchantLabel, raw.description, typeHint, bankCategory].filter(Boolean).join(" ");
  const fromRules = categorize(text);
  const category = fromRules !== "Other" ? fromRules : tagFromBankCategory(bankCategory, raw.amount);
  const type = inferType(text, raw.amount, category);
  const amount = raw.directionKnown ? raw.amount : signFromType(raw.amount, type);

  return {
    id: raw.id,
    merchant: tidyMerchant(merchantLabel || raw.description),
    category,
    tags: [category],
    tagSource: "rules",
    extractedBy: "parser",
    date: formatDisplayDate(raw.dateIso),
    dateIso: raw.dateIso,
    amount,
    type,
    sourceFile: raw.sourceFile,
    confidence: raw.confidence,
  };
}
