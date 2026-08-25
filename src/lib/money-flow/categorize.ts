import type { TransactionType } from "@/lib/money-flow/types";

const RULES: Array<[RegExp, string]> = [
  [/\b(woolworths|coles|aldi|iga|harris farm|greengrocer|supermarket)\b/i, "Groceries"],
  [/\b(netflix|spotify|disney|stan|youtube|apple\.com\/bill|prime video)\b/i, "Subscriptions"],
  [/\b(opal|uber|transport|train|bus|petrol|fuel|shell|bp |caltex|ampol|7-eleven)\b/i, "Transport"],
  [/\b(rent|landlord|mortgage|realestate|housing|strata)\b/i, "Housing"],
  [/\b(cafe|coffee|restaurant|menulog|doordash|uber ?eats|dining|mcdonald|grilld|guzman)\b/i, "Dining"],
  [/\b(bunnings|kmart|target|myer|amazon|the iconic|jb hi-fi|officeworks)\b/i, "Shopping"],
  [/\b(salary|wage|payroll|pay from|employer)\b/i, "Income"],
  [/\b(transfer to savings|savings|round.?up|goal)\b/i, "Goals"],
  [/\b(origin|agl|energy|water|internet|telstra|optus|vodafone|utility|electric)\b/i, "Utilities"],
  [/\b(medicare|chemist|pharmacy|priceline|doctor|hospital|health)\b/i, "Health"],
  [/\b(qantas|jetstar|airbnb|hotel|booking\.com|travel)\b/i, "Travel"],
  [/\b(event|cinema|ticketek|entertainment)\b/i, "Entertainment"],
];

export function categorize(description: string): string {
  for (const [pattern, category] of RULES) {
    if (pattern.test(description)) return category;
  }
  return "Other";
}

export function inferType(description: string, amount: number, category: string): TransactionType {
  const text = description.toLowerCase();
  if (/\b(transfer|tfr|sweep)\b/.test(text) || category === "Goals") return "transfer";
  if (/\brefund|reversal|rebate\b/.test(text)) return "refund";
  if (amount > 0 || category === "Income") return "income";
  return "expense";
}

export function tidyMerchant(description: string): string {
  const cleaned = description
    .replace(/\s+/g, " ")
    .replace(/^(visa|eftpos|pending|card purchase|purchase)\s+/i, "")
    .replace(/\s+\d{4,}$/g, "")
    .trim();
  if (!cleaned) return "Unknown";
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bPty\b/g, "Pty")
    .replace(/\bLtd\b/g, "Ltd");
}
