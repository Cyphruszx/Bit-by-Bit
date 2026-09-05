import {
  categoryLabel,
  CATEGORY_KEYS,
  isCategoryKey,
  splitSuggestion,
  SUGGESTIONS,
  tagsFor,
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
  [/\b(uber ?eats|menulog|doordash|deliveroo|hungry ?panda)\b/i, "eating-out.takeaway"],
  [/\b(woolworths|coles|aldi|iga|foodworks|harris farm|greengrocer|supermarket|wojia)\b/i, "groceries.groceries"],
  [/\b(bws|dan murphy|liquorland|first choice liquor|bottle ?[o0])\b/i, "eating-out.alcohol"],
  [
    /\b(cafe|coffee|restaurant|dining|mcdonald|kfc|hungry jack|red rooster|nando|subway|grill.?d|guzman|zambrero|sushia|soul origin|roll viet|domino|thaigga|uneke)\b/i,
    "eating-out.restaurants",
  ],
  [
    /\b(netflix|spotify|disney|stan|youtube|google play|google one|amazon prime|discord|brave|apple\.com\/bill|prime video)\b/i,
    "entertainment.streaming",
  ],
  [/\b(event|cinema|ticketek|ticketmaster|entertainment|townhouse|ice zoo)\b/i, "entertainment.events"],
  [/\b(petrol|fuel|shell|bp|caltex|ampol|7-eleven|wagga motors)\b/i, "car.fuel"],
  [/\b(opal|uber|train|bus|transport)\b/i, "getting-around"],
  // Rent going out is housing; rent arriving is income. The same word at opposite ends.
  [/\brent\b/i, "other-income.rent-received", "in"],
  [/\b(rent|landlord|mortgage|realestate|housing|strata)\b/i, "rent-mortgage"],
  [
    /\b(bunnings|ikea|hardware|furniture)\b/i,
    "home-garden",
  ],
  [
    /\b(kmart|target|myer|amazon|big w|the iconic|jb hi-fi|officeworks|shopify|kitchen antics)\b/i,
    "shopping",
  ],
  [/\b(exetel|telstra|optus|vodafone|internet|mobile)\b/i, "internet-phone"],
  [/\b(origin|agl|energy|water|utility|electric)\b/i, "utilities"],
  // Medicare, both ways. A payment to a practice is health spending; money arriving from
  // Medicare is a benefit, and the old table filed $120,844.20 of it under Health.
  [/\b(medicare|mcare benefits)\b/i, "other-income.rebate", "in"],
  [/\b(medicare|chemist|pharmacy|priceline|blooms|doctor|hospital|health|glofox)\b/i, "medical"],
  [/\b(qantas|jetstar|airbnb|hotel|booking\.com|travel|canberra airport)\b/i, "travel"],
  // Consumer lenders. A drawdown is not income and a repayment is not spending, and the
  // direction is the only thing that tells the two apart under one name.
  [/\b(societyone|latitude fin|harmoney|plenti|wisr|now finance|moneyme|nimble loans)\b/i, "debt-payments.drawdown", "in"],
  [/\b(societyone|latitude fin|harmoney|plenti|wisr|now finance|moneyme|nimble loans)\b/i, "debt-payments.loan-repayment"],
  [/\binterest charged\b/i, "bank-fees.interest-charged", "out"],
  [/\binterest\b/i, "other-income.interest-earned", "in"],
  [/\b(centrelink|services australia|veterans|vta benefits|dva)\b/i, "other-income.government-benefit", "in"],
  // A payment to the ATO is tax; money from the ATO is a refund of it.
  [/\b(australian taxation|ato|tax office)\b/i, "other-income.rebate", "in"],
  [/\b(australian taxation|ato|tax office)\b/i, "government-tax.ato"],
  [/\b(account fee|monthly fee|overdrawn|dishonour|card fee)\b/i, "bank-fees"],
  [/\b(salary|wage|payroll|pay from|employer)\b/i, "salary", "in"],
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

/** Everything a model may answer with: a category, or a category and one of its tags. */
export const KNOWN_CATEGORIES = SUGGESTIONS;

/**
 * A loose answer onto a real category and, where it was specific enough, a tag.
 *
 * Accepts the key, the dotted form, a display name, or a bare tag slug, because a model
 * asked for "groceries" will sometimes say "Groceries" and sometimes "Food & Drink"
 * and both are usable.
 */
export function snapCategory(raw: string): { categoryKey: string; tag?: string } | null {
  const written = raw.trim();
  if (!written) return null;
  const tidy = written.toLowerCase().replace(/\s*[·>/]\s*/g, ".").replace(/\s+/g, "-");

  if (isCategoryKey(tidy)) return { categoryKey: tidy };
  if (tidy.includes(".")) {
    const split = splitSuggestion(tidy);
    if (split.categoryKey !== UNCATEGORISED) return split;
  }

  const byLabel = CATEGORY_KEYS.find((key) => categoryLabel(key).toLowerCase() === written.toLowerCase());
  if (byLabel) return { categoryKey: byLabel };

  const needle = written.toLowerCase();
  for (const key of CATEGORY_KEYS) {
    const tag = tagsFor(key).find((name) => name.toLowerCase() === needle);
    if (tag) return { categoryKey: key, tag };
  }

  // A bare tag slug, where a model answered "restaurants" rather than "eating-out.restaurants".
  const bare = SUGGESTIONS.find((key) => key.endsWith(`.${tidy}`));
  return bare ? splitSuggestion(bare) : null;
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
