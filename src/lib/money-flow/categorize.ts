import {
  CATEGORY_KEYS,
  categoryLabel,
  isCategoryKey,
  typeForCategory,
  UNCATEGORISED,
} from "@/lib/money-flow/taxonomy";
import type { TransactionType } from "@/lib/money-flow/types";

/**
 * A rule that recognises a merchant, and the direction it only holds in.
 *
 * Direction is the part the old table had no room for. One pattern used to have to answer
 * for both a payment and a receipt, so `medicare` meant health spending whichever way the
 * money went and a $662.40 benefit arrived wearing an expense category. Splitting the rule
 * by direction is what lets one recognisable name mean two honest things.
 */
type Rule = [pattern: RegExp, category: string, when?: "in" | "out"];

const RULES: Rule[] = [
  // Delivery before transport, or `uber` claims `UBER *EATS` on its way past — which is
  // exactly what happened, and is why a year of takeaway read as travel costs.
  [/\b(uber ?eats|menulog|doordash|deliveroo|hungry ?panda)\b/i, "food.takeaway"],
  [/\b(woolworths|coles|aldi|iga|foodworks|harris farm|greengrocer|supermarket|wojia)\b/i, "food.groceries"],
  [/\b(bws|dan murphy|liquorland|first choice liquor|bottle ?[o0])\b/i, "food.alcohol"],
  [
    /\b(cafe|coffee|restaurant|dining|mcdonald|kfc|hungry jack|red rooster|nando|subway|grill.?d|guzman|zambrero|sushia|soul origin|roll viet|domino|thaigga|uneke)\b/i,
    "food.restaurants",
  ],
  [
    /\b(netflix|spotify|disney|stan|youtube|google play|google one|amazon prime|discord|brave|apple\.com\/bill|prime video)\b/i,
    "leisure.streaming",
  ],
  [/\b(event|cinema|ticketek|ticketmaster|entertainment|townhouse|ice zoo)\b/i, "leisure.events"],
  [/\b(opal|uber|train|bus|petrol|fuel|shell|bp|caltex|ampol|7-eleven|wagga motors|transport)\b/i, "transport"],
  // Rent going out is housing; rent arriving is income. The same word at opposite ends.
  [/\brent\b/i, "income.rent-received", "in"],
  [/\b(rent|landlord|mortgage|realestate|housing|strata)\b/i, "home"],
  [
    /\b(bunnings|kmart|target|myer|amazon|ikea|big w|the iconic|jb hi-fi|officeworks|shopify|kitchen antics)\b/i,
    "shopping",
  ],
  [/\b(origin|agl|energy|water|internet|exetel|telstra|optus|vodafone|utility|electric)\b/i, "utilities"],
  // Medicare, both ways. A payment to a practice is health spending; money arriving from
  // Medicare is a benefit, and the old table filed $120,844.20 of it under Health.
  [/\b(medicare|mcare benefits)\b/i, "income.rebate", "in"],
  [/\b(medicare|chemist|pharmacy|priceline|blooms|doctor|hospital|health|glofox)\b/i, "health.gp-specialist"],
  [/\b(qantas|jetstar|airbnb|hotel|booking\.com|travel|canberra airport)\b/i, "travel"],
  // Consumer lenders. A drawdown is not income and a repayment is not spending, and the
  // direction is the only thing that tells the two apart under one name.
  [/\b(societyone|latitude fin|harmoney|plenti|wisr|now finance|moneyme|nimble loans)\b/i, "debt.drawdown", "in"],
  [/\b(societyone|latitude fin|harmoney|plenti|wisr|now finance|moneyme|nimble loans)\b/i, "debt.loan-repayment"],
  [/\binterest charged\b/i, "money.interest-charged", "out"],
  [/\binterest\b/i, "income.interest", "in"],
  [/\b(centrelink|services australia|veterans|vta benefits|dva)\b/i, "income.government-benefit", "in"],
  // A payment to the ATO is tax; money from the ATO is a refund of it.
  [/\b(australian taxation|ato|tax office)\b/i, "income.rebate", "in"],
  [/\b(australian taxation|ato|tax office)\b/i, "govt.ato"],
  [/\b(account fee|monthly fee|overdrawn|dishonour|card fee)\b/i, "money.bank-fees"],
  [/\b(salary|wage|payroll|pay from|employer)\b/i, "income.salary", "in"],
];

/**
 * The category a rule recognises, or null when none does.
 *
 * Null is deliberate and is not "Other". A movement nothing recognised has not been sorted
 * into a bucket — it is waiting to be looked at, and only saying so separately keeps a
 * genuine miss from hiding among the things a person filed under Other on purpose.
 */
export function categorize(description: string, amount: number): string | null {
  const direction = amount > 0 ? "in" : "out";
  for (const [pattern, category, when] of RULES) {
    if (when && when !== direction) continue;
    if (pattern.test(description)) return category;
  }
  return null;
}

/** Every category a person or a model may choose from, by key. */
export const KNOWN_CATEGORIES = CATEGORY_KEYS;

/**
 * A loose name onto a real category. Accepts the key itself, the display name, or an old
 * tag, so what a model returns and what a person types land in the same place.
 */
export function snapCategory(raw: string): string | null {
  const tidy = raw.trim().toLowerCase().replace(/\s*[·>/]\s*/g, ".").replace(/\s+/g, "-");
  if (!tidy) return null;
  if (isCategoryKey(tidy)) return tidy;
  const byLabel = CATEGORY_KEYS.find((key) => categoryLabel(key).toLowerCase() === raw.trim().toLowerCase());
  if (byLabel) return byLabel;
  // A bare child name, where a model answered "groceries" rather than "food.groceries".
  return CATEGORY_KEYS.find((key) => key.endsWith(`.${tidy}`)) ?? null;
}

/**
 * The type a movement takes, from its category and the way the money went.
 *
 * Nothing here reads the bank's wording any more. A bank saying "transfer" is a claim
 * about two accounts, and the only thing that settles it is finding the other leg — which
 * transfers.ts does over the whole ledger and writes back as `moved`. Guessing it from a
 * word was how a $200 payment to a person and a $25,000 loan both stopped being real.
 */
export function inferType(categoryKey: string, amount: number): TransactionType {
  return typeForCategory(isCategoryKey(categoryKey) ? categoryKey : UNCATEGORISED, amount);
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
