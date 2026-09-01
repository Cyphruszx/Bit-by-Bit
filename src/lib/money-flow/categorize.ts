import { tidyTag } from "@/lib/money-flow/tags";
import type { TransactionType } from "@/lib/money-flow/types";

export const KNOWN_TAGS = [
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Subscriptions",
  "Health",
  "Travel",
  "Income",
  "Goals",
  "Other",
] as const;

const RULES: Array<[RegExp, string]> = [
  [/\b(woolworths|coles|aldi|iga|foodworks|harris farm|greengrocer|supermarket|wojia)\b/i, "Groceries"],
  [/\b(netflix|spotify|disney|stan|youtube|google play|google one|amazon prime|discord|brave|apple\.com\/bill|prime video)\b/i, "Subscriptions"],
  [/\b(opal|uber|transport|train|bus|petrol|fuel|shell|bp|caltex|ampol|7-eleven|wagga motors)\b/i, "Transport"],
  [/\b(rent|landlord|mortgage|realestate|housing|strata)\b/i, "Housing"],
  [/\b(cafe|coffee|restaurant|menulog|doordash|uber ?eats|dining|mcdonald|grill.?d|guzman|zambrero|sushia|soul origin|roll viet|domino|thaigga|uneke)\b/i, "Dining"],
  [/\b(bunnings|kmart|target|myer|amazon|ikea|big w|the iconic|jb hi-fi|officeworks|shopify|kitchen antics)\b/i, "Shopping"],
  [/\b(salary|wage|payroll|pay from|employer|osko payment received)\b/i, "Income"],
  [/\b(transfer to|transfer from|savings|round.?up|goal)\b/i, "Goals"],
  [/\b(origin|agl|energy|water|internet|exetel|telstra|optus|vodafone|utility|electric)\b/i, "Utilities"],
  [/\b(medicare|chemist|pharmacy|priceline|blooms|doctor|hospital|health|glofox)\b/i, "Health"],
  [/\b(qantas|jetstar|airbnb|hotel|booking\.com|travel|canberra airport)\b/i, "Travel"],
  [/\b(event|cinema|ticketek|ticketmaster|entertainment|townhouse|ice zoo|bws)\b/i, "Entertainment"],
];

export function categorize(description: string): string {
  for (const [pattern, category] of RULES) {
    if (pattern.test(description)) return category;
  }
  return "Other";
}

export function snapTag(raw: string, allowNew = false): string {
  const tidy = tidyTag(raw);
  if (!tidy) return "Other";
  const known = KNOWN_TAGS.find((tag) => tag.toLowerCase() === tidy.toLowerCase());
  if (known) return known;
  if (allowNew && /^[\p{L}\p{N}][\p{L}\p{N} &/'()-]{0,39}$/u.test(tidy)) return tidy;
  return "Other";
}

export function inferType(description: string, amount: number, category: string): TransactionType {
  const text = description.toLowerCase();
  if (/\b(refund|reversal|rebate)/.test(text)) return "refund";
  if (/\b(transfer|tfr|sweep)\b/.test(text) || category === "Goals") return "transfer";
  if (amount < 0) return "expense";
  if (amount > 0 || category === "Income" || /\bosko payment received|\binterest\b/.test(text)) return "income";
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
