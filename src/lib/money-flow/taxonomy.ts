/**
 * What a movement is, and what it was for.
 *
 * These are two questions and the app used to answer them with one word. A flat list of
 * thirteen tags carried the category, the direction, the transfer marker and the fallback
 * bucket all at once, so a Medicare benefit of +$662.40 could be filed under "Health" —
 * a credit wearing an expense category — and a $25,000 loan drawdown could be filed under
 * "Goals" and counted as income. Neither is a labelling mistake that a better rule fixes.
 * The model had nowhere to put the difference.
 *
 * So: a **type** says whether this changed what the household owns. A **category** says
 * what the money was for. A **tag** is anything else the person wants to find it by.
 *
 * Type is derived rather than stored twice: a category knows which type it takes on the
 * way in and which on the way out, so "Medicare" as a payment is health spending and
 * "Medicare" as a receipt is income, from one rule.
 *
 * Categories are the middle of three levels: a group is a folder for charts, a category
 * is what a movement is filed under, and a bank label is mapping and find-by metadata.
 * One movement, one category, any number of tags — tags never move a figure.
 */

/** Whether a movement changed what the household owns, and in which direction. */
export type TransactionType =
  | "earned"
  | "returned"
  | "borrowed"
  | "moved"
  | "spent"
  | "repaid"
  | "invested"
  | "adjusted";

type TypeMeaning = {
  label: string;
  /** Which side of the ledger a person would be offered this on. */
  side: "in" | "out" | "both";
  /** Whether a credit of this type is money the household earned. */
  income: boolean;
  /** Whether a debit of this type is money the household spent. */
  spending: boolean;
};

/**
 * The six a person is already offered by name in verdicts.ts, plus repaying and investing,
 * which the old four-type list had nowhere for, plus adjusted for a reversal.
 *
 * Borrowing is the one worth reading twice. $25,000 arriving from a lender is not income
 * and paying it back is not spending; treating either as real is what destroyed the month
 * in the sample statements. Both legs move cash and neither changes what is owned, so both
 * sit outside income and spending while staying in the raw cash figures.
 *
 * `moved` and `returned` still count, which reads like a contradiction and is not. The two
 * of them are the only types that are *proved* rather than inferred — written by the
 * matcher that found the other leg or the payment being reversed — and the pair is what
 * takes the money out, in summary.ts, and only when both legs are in the set being
 * summarised. Taking it out here as well would take it out twice, and would break scoping:
 * seen from inside Up alone, money that arrived from NAB did arrive, and Up's figures have
 * to tie to Up's own statement. So the rule is: a type the reader *proved* leaves the
 * arithmetic to the pair, and a type it *inferred from a category* does the arithmetic
 * itself.
 */
const TYPES: Record<TransactionType, TypeMeaning> = {
  earned: { label: "Money you earned", side: "in", income: true, spending: false },
  returned: { label: "Money coming back", side: "in", income: true, spending: false },
  borrowed: { label: "Borrowed money", side: "in", income: false, spending: false },
  moved: { label: "Between your own accounts", side: "both", income: true, spending: true },
  spent: { label: "Money you spent", side: "out", income: false, spending: true },
  repaid: { label: "Paying back what you borrowed", side: "out", income: false, spending: false },
  invested: { label: "Money into an investment", side: "out", income: false, spending: false },
  adjusted: { label: "A correction", side: "both", income: false, spending: false },
};

export const TRANSACTION_TYPES = Object.keys(TYPES) as TransactionType[];

export function isTransactionType(value: unknown): value is TransactionType {
  return typeof value === "string" && value in TYPES;
}

export function typeLabel(type: TransactionType): string {
  return TYPES[type]?.label ?? type;
}

/** Whether a credit of this type belongs in the money-in figure. */
export function countsAsIncome(type: TransactionType): boolean {
  return TYPES[type]?.income ?? true;
}

/** Whether a debit of this type belongs in the money-out figure. */
export function countsAsSpending(type: TransactionType): boolean {
  return TYPES[type]?.spending ?? true;
}

/** The types worth offering for a movement of this direction, which is what a person picks from. */
export function typesFor(amount: number): { type: TransactionType; label: string }[] {
  const side = amount > 0 ? "in" : "out";
  return TRANSACTION_TYPES.filter((type) => TYPES[type].side === side || TYPES[type].side === "both").map(
    (type) => ({ type, label: TYPES[type].label }),
  );
}

/**
 * Which way a type points, for the readers that have to sign an amount before they know
 * anything else about it. A type that goes both ways leaves the sign alone.
 */
export function inflowType(type: TransactionType): boolean {
  return TYPES[type]?.side === "in";
}

// ---------------------------------------------------------------------------
// Categories, and the tags that come with them
// ---------------------------------------------------------------------------

/**
 * A tag the app offers against a category: the slug an older ledger stored it under, and
 * the name a person reads.
 *
 * The slug is kept because it is what `food.groceries` meant, and a movement filed that way
 * has to land on the right tag when it is read back.
 */
type Suggestion = [slug: string, tag: string];

type Category = {
  key: string;
  label: string;
  /** The type a credit in this category takes. */
  inType: TransactionType;
  /** The type a debit takes. */
  outType: TransactionType;
  /** Offered as tags when this category is chosen. Never required, never exhaustive. */
  tags: Suggestion[];
};

/**
 * The Redbark PDF categories, each with the bank names it offers as tags.
 *
 * Every category takes `earned` on the way in, which looks wrong until you try the
 * alternative. Typing a credit `returned` because it landed in a spending category means a
 * rule that mis-files one credit silently deletes it from income — four ATO refunds worth
 * $3,964 vanished from the sample statements that way, and nothing on screen would have
 * said so. So `moved` and `returned` are only ever *proved*: written by the matcher that
 * found the other leg or the payment being reversed, or by the person saying so. A credit
 * sitting under Groceries is a rule getting it wrong, and it still counts until somebody
 * fixes the category.
 *
 * Investing is kept even though the PDF has no Investing group: Super and brokerage
 * outflows have to stay `invested`, not spending. Transfers is listed so the Categories
 * tab can hold the bank labels; unmatched transfer rows are still not filed from those
 * words alone.
 */
const CATEGORIES: Category[] = [
  {
    key: "salary",
    label: "Salary",
    inType: "earned",
    outType: "adjusted",
    tags: [["salary", "Salary"]],
  },
  {
    key: "other-income",
    label: "Other Income",
    inType: "earned",
    outType: "adjusted",
    tags: [
      ["income", "Income"],
      ["business-income", "Business Income"],
      ["business", "Business"],
      ["tax-refund", "Tax Refund"],
      ["rebate", "Rebate"],
      ["government-benefits", "Government Benefits"],
      ["government-benefit", "Government Benefit"],
      ["investment-income", "Investment Income"],
      ["dividends", "Dividends"],
      ["interest-earned", "Interest Earned"],
      ["rental-income", "Rental Income"],
      ["rent-received", "Rent Received"],
      ["child-support", "Child Support"],
      ["other-income", "Other Income"],
    ],
  },
  {
    key: "rent-mortgage",
    label: "Rent & Mortgage",
    inType: "earned",
    outType: "spent",
    tags: [
      ["rent", "Rent"],
      ["mortgage-payment", "Mortgage Payment"],
      ["mortgage-interest", "Mortgage Interest"],
      ["strata", "Strata"],
      ["council-rates", "Council Rates"],
      ["maintenance", "Maintenance"],
      ["home-insurance", "Home Insurance"],
    ],
  },
  {
    key: "utilities",
    label: "Utilities",
    inType: "earned",
    outType: "spent",
    tags: [
      ["gas-electricity", "Gas & Electricity"],
      ["electricity", "Electricity"],
      ["gas", "Gas"],
      ["water", "Water"],
      ["sewage-waste", "Sewage & Waste"],
      ["other-utilities", "Other Utilities"],
    ],
  },
  {
    key: "internet-phone",
    label: "Internet & Phone",
    inType: "earned",
    outType: "spent",
    tags: [
      ["internet-cable", "Internet & Cable"],
      ["internet", "Internet"],
      ["telephone", "Telephone"],
      ["mobile", "Mobile"],
    ],
  },
  {
    key: "home-garden",
    label: "Home & Garden",
    inType: "earned",
    outType: "spent",
    tags: [
      ["home-improvement", "Home Improvement"],
      ["furniture", "Furniture"],
      ["hardware", "Hardware"],
    ],
  },
  {
    key: "groceries",
    label: "Groceries",
    inType: "earned",
    outType: "spent",
    tags: [["groceries", "Groceries"]],
  },
  {
    key: "eating-out",
    label: "Eating Out",
    inType: "earned",
    outType: "spent",
    tags: [
      ["food-drink", "Food & Drink"],
      ["beer-wine-liquor", "Beer, Wine & Liquor"],
      ["alcohol", "Alcohol"],
      ["fast-food", "Fast Food"],
      ["restaurant", "Restaurant"],
      ["restaurants", "Restaurants"],
      ["takeaway", "Takeaway"],
      ["coffee", "Coffee"],
      ["other-food-drink", "Other Food & Drink"],
    ],
  },
  {
    key: "getting-around",
    label: "Getting Around",
    inType: "earned",
    outType: "spent",
    tags: [
      ["transportation", "Transportation"],
      ["bikes-scooters", "Bikes & Scooters"],
      ["public-transit", "Public Transit"],
      ["public-transport", "Public Transport"],
      ["taxis-ride-shares", "Taxis & Ride Shares"],
      ["rideshare", "Rideshare"],
      ["parking", "Parking"],
      ["parking-tolls", "Parking & Tolls"],
      ["tolls", "Tolls"],
      ["ev-charging", "EV Charging"],
      ["other-transportation", "Other Transportation"],
    ],
  },
  {
    key: "car",
    label: "Car",
    inType: "earned",
    outType: "spent",
    tags: [
      ["car-payment", "Car Payment"],
      ["automotive", "Automotive"],
      ["fuel", "Fuel"],
      ["service", "Service"],
      ["servicing", "Servicing"],
      ["rego-ctp", "Rego & CTP"],
      ["car-insurance", "Car Insurance"],
    ],
  },
  {
    key: "entertainment",
    label: "Entertainment",
    inType: "earned",
    outType: "spent",
    tags: [
      ["entertainment", "Entertainment"],
      ["casinos-gambling", "Casinos & Gambling"],
      ["music-audio", "Music & Audio"],
      ["events-amusement", "Events & Amusement"],
      ["events", "Events"],
      ["tv-movies", "TV & Movies"],
      ["streaming", "Streaming"],
      ["video-games", "Video Games"],
      ["gaming", "Gaming"],
      ["software", "Software"],
      ["sport", "Sport"],
      ["other-entertainment", "Other Entertainment"],
    ],
  },
  {
    key: "shopping",
    label: "Shopping",
    inType: "earned",
    outType: "spent",
    tags: [
      ["merchandise", "Merchandise"],
      ["books-news", "Books & News"],
      ["clothing-accessories", "Clothing & Accessories"],
      ["clothing", "Clothing"],
      ["convenience-stores", "Convenience Stores"],
      ["department-stores", "Department Stores"],
      ["office-supplies", "Office Supplies"],
      ["online-marketplaces", "Online Marketplaces"],
      ["sporting-goods", "Sporting Goods"],
      ["tobacco-vape", "Tobacco & Vape"],
      ["other-merchandise", "Other Merchandise"],
      ["homewares", "Homewares"],
      ["electronics", "Electronics"],
      ["hobbies", "Hobbies"],
      ["gifts", "Gifts"],
    ],
  },
  {
    key: "personal-care",
    label: "Personal Care",
    inType: "earned",
    outType: "spent",
    tags: [
      ["personal-care", "Personal Care"],
      ["gyms-fitness", "Gyms & Fitness"],
      ["fitness", "Fitness"],
      ["hair-beauty", "Hair & Beauty"],
      ["laundry-dry-cleaning", "Laundry & Dry Cleaning"],
      ["other-personal-care", "Other Personal Care"],
    ],
  },
  {
    key: "travel",
    label: "Travel",
    inType: "earned",
    outType: "spent",
    tags: [
      ["travel", "Travel"],
      ["flights", "Flights"],
      ["rental-cars", "Rental Cars"],
      ["hotels", "Hotels"],
      ["accommodation", "Accommodation"],
      ["transport-abroad", "Transport Abroad"],
      ["travel-insurance", "Travel Insurance"],
      ["other-travel", "Other Travel"],
    ],
  },
  {
    key: "medical",
    label: "Medical",
    inType: "earned",
    outType: "spent",
    tags: [
      ["medical", "Medical"],
      ["aged-care", "Aged Care"],
      ["pharmacies-supplements", "Pharmacies & Supplements"],
      ["pharmacy", "Pharmacy"],
      ["primary-care", "Primary Care"],
      ["gp-specialist", "GP & Specialists"],
      ["dental", "Dental"],
      ["optical", "Optical"],
      ["private-cover", "Private Health Cover"],
      ["other-medical", "Other Medical"],
    ],
  },
  {
    key: "pets",
    label: "Pets",
    inType: "earned",
    outType: "spent",
    tags: [
      ["pets", "Pets"],
      ["pet-supplies", "Pet Supplies"],
      ["veterinary-services", "Veterinary Services"],
    ],
  },
  {
    key: "insurance",
    label: "Insurance",
    inType: "earned",
    outType: "spent",
    tags: [["insurance", "Insurance"]],
  },
  {
    key: "education-childcare",
    label: "Education & Childcare",
    inType: "earned",
    outType: "spent",
    tags: [
      ["education", "Education"],
      ["childcare", "Childcare"],
      ["child-care", "Child Care"],
    ],
  },
  {
    key: "debt-payments",
    label: "Debt Payments",
    inType: "borrowed",
    outType: "repaid",
    tags: [
      ["loan-payments", "Loan Payments"],
      ["credit-card-payment", "Credit Card Payment"],
      ["personal-loan-payment", "Personal Loan Payment"],
      ["student-loan-payment", "Student Loan Payment"],
      ["other-loan-payment", "Other Loan Payment"],
      ["cash-advances-loans", "Cash Advances & Loans"],
      ["drawdown", "Drawdown"],
      ["loan-repayment", "Loan Repayment"],
      ["bnpl", "Buy Now Pay Later"],
    ],
  },
  {
    key: "bank-fees",
    label: "Bank Fees",
    inType: "earned",
    outType: "spent",
    tags: [
      ["bank-fees", "Bank Fees"],
      ["atm-fees", "ATM Fees"],
      ["insufficient-funds", "Insufficient Funds"],
      ["interest-charge", "Interest Charge"],
      ["interest-charged", "Interest Charged"],
      ["overdraft-fees", "Overdraft Fees"],
      ["other-bank-fees", "Other Bank Fees"],
      ["foreign-fees", "Foreign Transaction Fees"],
      ["professional-fees", "Professional Fees"],
    ],
  },
  {
    key: "invest",
    label: "Investing",
    inType: "earned",
    outType: "invested",
    tags: [
      ["contribution", "Contribution"],
      ["brokerage-fee", "Brokerage Fee"],
      ["super", "Super"],
    ],
  },
  {
    key: "donations",
    label: "Donations",
    inType: "earned",
    outType: "spent",
    tags: [
      ["donations", "Donations"],
      ["charity", "Charity"],
    ],
  },
  {
    key: "government-tax",
    label: "Government & Tax",
    inType: "earned",
    outType: "spent",
    tags: [
      ["government-non-profit", "Government & Non-Profit"],
      ["government-services", "Government Services"],
      ["tax-payment", "Tax Payment"],
      ["other-government", "Other Government"],
      ["ato", "ATO"],
      ["hecs-help", "HECS-HELP"],
      ["fines", "Fines"],
    ],
  },
  {
    key: "transfers",
    label: "Transfers",
    inType: "earned",
    outType: "spent",
    tags: [
      ["transfer-in", "Transfer In"],
      ["transfer-out", "Transfer Out"],
      ["deposit", "Deposit"],
      ["withdrawal", "Withdrawal"],
      ["other-transfer", "Other Transfer"],
      ["internal-transfers", "Internal Transfers"],
    ],
  },
];

/** Chosen on purpose, and so never treated as a movement nobody has looked at. */
export const OTHER = "other";

/**
 * Nothing decided yet. Kept apart from Other because the old model used one bucket for
 * both, which is how KFC ended up sitting beside genuine oddities with no way to tell a
 * miss from a decision.
 */
export const UNCATEGORISED = "uncategorised";

const LOOSE: Record<string, { label: string; inType: TransactionType; outType: TransactionType }> = {
  [OTHER]: { label: "Other", inType: "earned", outType: "spent" },
  // Counted rather than quarantined, and flagged: money that arrived is money in until
  // somebody says otherwise, which is the same call the ledger already makes elsewhere.
  [UNCATEGORISED]: { label: "Not sorted yet", inType: "earned", outType: "spent" },
};

const BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));
const BUILTIN_KEYS = new Set([...CATEGORIES.map((category) => category.key), OTHER, UNCATEGORISED]);

export type ListedCategory = {
  key: string;
  label: string;
  inType: TransactionType;
  outType: TransactionType;
  tags: string[];
};

/** The named filing categories, without the two loose buckets. */
export function listBuiltinCategories(): ListedCategory[] {
  return CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    inType: category.inType,
    outType: category.outType,
    tags: category.tags.map(([, tag]) => tag),
  }));
}

/** Other and Not sorted yet — real filing keys, not ones a person adds. */
export function listLooseCategories(): ListedCategory[] {
  return [OTHER, UNCATEGORISED].map((key) => ({
    key,
    label: LOOSE[key].label,
    inType: LOOSE[key].inType,
    outType: LOOSE[key].outType,
    tags: [],
  }));
}

export function isBuiltinCategoryKey(key: string): boolean {
  return BUILTIN_KEYS.has(key);
}

/**
 * A person's category list, applied over the built-in filing keys.
 *
 * The keys a statement was filed under have to keep meaning the same thing after a rename,
 * so the overlay never rewrites a key — only the name a person reads, the tags a picker
 * offers, and any extra keys they have added.
 */
export type CategoryOverlay = {
  categories: Array<{
    key: string;
    label: string;
    inType: TransactionType;
    outType: TransactionType;
    bankCategories: string[];
  }>;
};

type Overlay = {
  labels: Map<string, string>;
  extras: Map<string, { label: string; inType: TransactionType; outType: TransactionType }>;
  tags: Map<string, Suggestion[]>;
  bankToSuggestion: Map<string, string>;
};

function emptyOverlay(): Overlay {
  return { labels: new Map(), extras: new Map(), tags: new Map(), bankToSuggestion: new Map() };
}

const overlay: Overlay = emptyOverlay();

function replaceOverlay(next: Overlay) {
  overlay.labels = next.labels;
  overlay.extras = next.extras;
  overlay.tags = next.tags;
  overlay.bankToSuggestion = next.bankToSuggestion;
  refreshKnown();
}

/** Installs a person's category list, or clears it so the built-in keys return. */
export function applyCategoryOverlay(spec: CategoryOverlay | null): void {
  if (!spec) {
    replaceOverlay(emptyOverlay());
    return;
  }

  const next = emptyOverlay();
  for (const category of spec.categories) {
    const key = category.key.trim();
    if (!key) continue;
    next.labels.set(key, category.label);
    const pairs: Suggestion[] = uniquePairs(category.bankCategories.map((name) => [slugify(name), name.trim()] as Suggestion));
    next.tags.set(key, pairs);
    if (!BUILTIN_KEYS.has(key)) {
      next.extras.set(key, { label: category.label, inType: category.inType, outType: category.outType });
    }
    // Transfers bank labels stay on the Categories tab. A bank saying "Transfer In"
    // is still only a claim — pairing settles it, not this map.
    if (key === "transfers") continue;
    for (const [slug, name] of pairs) {
      if (/\btransfers?\b/i.test(name)) continue;
      const needle = name.toLowerCase();
      if (next.bankToSuggestion.has(needle)) continue;
      next.bankToSuggestion.set(needle, slug ? `${key}.${slug}` : key);
    }
  }
  replaceOverlay(next);
}

/** A bank label the person has mapped, written as a category or `groceries`. */
export function categoryForBankLabel(raw: string | undefined): string | null {
  const needle = raw?.trim().toLowerCase();
  if (!needle) return null;
  return overlay.bankToSuggestion.get(needle) ?? null;
}

/** Every category a movement can be filed under. The built-in list, plus extras, plus the two loose ones. */
export const CATEGORY_KEYS: string[] = [...CATEGORIES.map((category) => category.key), OTHER, UNCATEGORISED];

const KNOWN = new Set(CATEGORY_KEYS);

function refreshKnown() {
  const extras = [...overlay.extras.keys()].filter((key) => !BUILTIN_KEYS.has(key)).sort();
  CATEGORY_KEYS.length = 0;
  CATEGORY_KEYS.push(...CATEGORIES.map((category) => category.key), ...extras, OTHER, UNCATEGORISED);
  KNOWN.clear();
  for (const key of CATEGORY_KEYS) KNOWN.add(key);
  SUGGESTIONS.length = 0;
  SUGGESTIONS.push(...computeSuggestions());
  SUGGESTED_TAGS.length = 0;
  SUGGESTED_TAGS.push(...computeSuggestedTags());
}

export function isCategoryKey(value: unknown): boolean {
  return typeof value === "string" && KNOWN.has(value);
}

export function categoryLabel(key: string | undefined): string {
  if (!key) return LOOSE[UNCATEGORISED].label;
  return overlay.labels.get(key) ?? LOOSE[key]?.label ?? BY_KEY.get(key)?.label ?? overlay.extras.get(key)?.label ?? titleCase(key);
}

/** Kept as its own name because callers mean "however this category should read on its own". */
export function categoryPath(key: string | undefined): string {
  return categoryLabel(key);
}

/** The tags this category offers. Suggestions only — a person can type anything. */
export function tagsFor(categoryKey: string | undefined): string[] {
  return tagPairsFor(categoryKey ?? "").map(([, tag]) => tag);
}

function tagPairsFor(key: string): Suggestion[] {
  return overlay.tags.get(key) ?? BY_KEY.get(key)?.tags ?? [];
}

function computeSuggestedTags(): string[] {
  return [...new Set(CATEGORY_KEYS.flatMap((key) => tagsFor(key)))].sort((a, b) => a.localeCompare(b));
}

function computeSuggestions(): string[] {
  return CATEGORY_KEYS.filter((key) => key !== UNCATEGORISED).flatMap((key) => [
    key,
    ...tagPairsFor(key).map(([slug]) => `${key}.${slug}`),
  ]);
}

/** Every tag the app suggests, for the pickers that are not scoped to one category. */
export const SUGGESTED_TAGS: string[] = computeSuggestedTags();

/**
 * Everything a rule or a model may answer with: a category on its own, or a category and
 * one of its tags written as `eating-out.restaurants`.
 *
 * The dotted form is kept as a *vocabulary* even though nothing stores it any more. It is
 * how the merchant rules stay legible — one line saying restaurants rather than two saying
 * eating-out and then Restaurants — and it lets a model answer at the level it is actually
 * sure of, which is usually the specific one. Older dotted keys such as `food.groceries`
 * are still read here so a stored row or a stale rule lands on the new filing key.
 */
export const SUGGESTIONS: string[] = computeSuggestions();

/**
 * Splits what a rule, a model or an older ledger said into the two things it now means.
 *
 * `food.groceries` used to be one key and is now Groceries. Reading it apart here is the
 * whole of the migration: every movement stored under the older model lands on the
 * category it already meant, and keeps the detail as a tag.
 */
export function splitSuggestion(raw: string | undefined): { categoryKey: string; tag?: string } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { categoryKey: UNCATEGORISED };

  const remembered = FROM_OLD[value];
  if (remembered) return { ...remembered };

  if (!value.includes(".")) {
    return { categoryKey: isCategoryKey(value) ? value : UNCATEGORISED };
  }

  const [head, ...rest] = value.split(".");
  if (!isCategoryKey(head)) return { categoryKey: UNCATEGORISED };

  const slug = rest.join(".");
  const found = tagPairsFor(head).find(([known]) => known === slug);
  return { categoryKey: head, ...(found ? { tag: found[1] } : {}) };
}

/**
 * A stored filing key, including the old fourteen, onto the PDF key it now means.
 *
 * Tags decide the splits the wording alone cannot: Food + Groceries is groceries, Food
 * alone is eating-out, Income + Salary is salary.
 */
export function migrateStoredCategory(
  key: string | undefined,
  tags?: string[],
): { categoryKey: string; tag?: string } {
  const raw = (key ?? "").trim().toLowerCase();
  if (!raw) return { categoryKey: UNCATEGORISED };

  const refined = refineOldKey(raw, tags);
  if (refined) return refined;
  if (isCategoryKey(raw)) return { categoryKey: raw };
  return splitSuggestion(raw);
}

function refineOldKey(key: string, tags?: string[]): { categoryKey: string; tag?: string } | null {
  const held = (tags ?? []).map((tag) => tag.toLowerCase());
  const has = (...needles: string[]) =>
    held.some((tag) => needles.some((needle) => tag === needle || tag.includes(needle)));

  if (key === "food") {
    if (has("groceries")) return { categoryKey: "groceries", tag: "Groceries" };
    return { categoryKey: "eating-out" };
  }
  if (key === "income") {
    if (has("salary")) return { categoryKey: "salary", tag: "Salary" };
    return { categoryKey: "other-income" };
  }
  if (key === "home") {
    if (has("furniture", "hardware", "home improvement", "homewares")) return { categoryKey: "home-garden" };
    return { categoryKey: "rent-mortgage" };
  }
  if (key === "utilities") {
    if (has("internet", "mobile", "telephone", "phone", "cable")) return { categoryKey: "internet-phone" };
    return isCategoryKey(key) ? null : { categoryKey: "utilities" };
  }
  if (key === "transport") {
    if (has("fuel", "car", "rego", "ctp", "servic", "automotive", "ampol", "shell", "petrol")) {
      return { categoryKey: "car" };
    }
    return { categoryKey: "getting-around" };
  }
  if (key === "people") {
    if (has("childcare", "child care", "education")) return { categoryKey: "education-childcare" };
    if (has("pets", "vet")) return { categoryKey: "pets" };
    if (has("donation", "charity")) return { categoryKey: "donations" };
    return { categoryKey: "personal-care" };
  }
  if (key === "money") {
    if (has("insurance")) return { categoryKey: "insurance" };
    return { categoryKey: "bank-fees" };
  }
  if (key === "health") return { categoryKey: "medical" };
  if (key === "leisure") return { categoryKey: "entertainment" };
  if (key === "govt") return { categoryKey: "government-tax" };
  if (key === "debt") return { categoryKey: "debt-payments" };
  return null;
}

/**
 * The type a category takes in this direction.
 *
 * This is the whole reason the two layers are separate. One rule recognises Medicare, and
 * the direction decides whether that is a payment to a doctor or a benefit arriving — the
 * old model had to guess from the merchant alone and got it wrong in both directions.
 */
export function typeForCategory(key: string | undefined, amount: number): TransactionType {
  const extra = key ? overlay.extras.get(key) : undefined;
  const held = key ? (LOOSE[key] ?? extra ?? BY_KEY.get(key)) : undefined;
  const meaning = held ?? LOOSE[UNCATEGORISED];
  return amount > 0 ? meaning.inType : meaning.outType;
}

/**
 * Older dotted keys and the fourteen flat keys they sat under, mapped onto the PDF list.
 *
 * Kept beside `splitSuggestion` so a rule that still says `food.groceries`, a model that
 * answers that way, or a ledger stored before this rewrite all land on the same key.
 */
const FROM_OLD: Record<string, { categoryKey: string; tag?: string }> = {
  "food.groceries": { categoryKey: "groceries", tag: "Groceries" },
  "food.restaurants": { categoryKey: "eating-out", tag: "Restaurants" },
  "food.takeaway": { categoryKey: "eating-out", tag: "Takeaway" },
  "food.coffee": { categoryKey: "eating-out", tag: "Coffee" },
  "food.alcohol": { categoryKey: "eating-out", tag: "Alcohol" },
  food: { categoryKey: "eating-out" },
  "home.rent": { categoryKey: "rent-mortgage", tag: "Rent" },
  "home.mortgage-interest": { categoryKey: "rent-mortgage", tag: "Mortgage Interest" },
  "home.strata": { categoryKey: "rent-mortgage", tag: "Strata" },
  "home.council-rates": { categoryKey: "rent-mortgage", tag: "Council Rates" },
  "home.maintenance": { categoryKey: "rent-mortgage", tag: "Maintenance" },
  "home.insurance": { categoryKey: "rent-mortgage", tag: "Home Insurance" },
  "home.furniture": { categoryKey: "home-garden", tag: "Furniture" },
  home: { categoryKey: "rent-mortgage" },
  housing: { categoryKey: "rent-mortgage" },
  "utilities.electricity": { categoryKey: "utilities", tag: "Electricity" },
  "utilities.gas": { categoryKey: "utilities", tag: "Gas" },
  "utilities.water": { categoryKey: "utilities", tag: "Water" },
  "utilities.internet": { categoryKey: "internet-phone", tag: "Internet" },
  "utilities.mobile": { categoryKey: "internet-phone", tag: "Mobile" },
  "transport.fuel": { categoryKey: "car", tag: "Fuel" },
  "transport.public-transport": { categoryKey: "getting-around", tag: "Public Transport" },
  "transport.rideshare": { categoryKey: "getting-around", tag: "Rideshare" },
  "transport.parking-tolls": { categoryKey: "getting-around", tag: "Parking & Tolls" },
  "transport.rego-ctp": { categoryKey: "car", tag: "Rego & CTP" },
  "transport.servicing": { categoryKey: "car", tag: "Servicing" },
  "transport.insurance": { categoryKey: "car", tag: "Car Insurance" },
  transport: { categoryKey: "getting-around" },
  "health.gp-specialist": { categoryKey: "medical", tag: "GP & Specialists" },
  "health.pharmacy": { categoryKey: "medical", tag: "Pharmacy" },
  "health.dental": { categoryKey: "medical", tag: "Dental" },
  "health.optical": { categoryKey: "medical", tag: "Optical" },
  "health.private-cover": { categoryKey: "medical", tag: "Private Health Cover" },
  "health.fitness": { categoryKey: "personal-care", tag: "Fitness" },
  health: { categoryKey: "medical" },
  "leisure.streaming": { categoryKey: "entertainment", tag: "Streaming" },
  "leisure.software": { categoryKey: "entertainment", tag: "Software" },
  "leisure.events": { categoryKey: "entertainment", tag: "Events" },
  "leisure.gaming": { categoryKey: "entertainment", tag: "Gaming" },
  "leisure.sport": { categoryKey: "entertainment", tag: "Sport" },
  leisure: { categoryKey: "entertainment" },
  "people.childcare": { categoryKey: "education-childcare", tag: "Childcare" },
  "people.education": { categoryKey: "education-childcare", tag: "Education" },
  "people.pets": { categoryKey: "pets", tag: "Pets" },
  "people.personal-care": { categoryKey: "personal-care", tag: "Personal Care" },
  "people.donations": { categoryKey: "donations", tag: "Donations" },
  people: { categoryKey: "personal-care" },
  "money.bank-fees": { categoryKey: "bank-fees", tag: "Bank Fees" },
  "money.interest-charged": { categoryKey: "bank-fees", tag: "Interest Charged" },
  "money.foreign-fees": { categoryKey: "bank-fees", tag: "Foreign Transaction Fees" },
  "money.professional-fees": { categoryKey: "bank-fees", tag: "Professional Fees" },
  "money.insurance": { categoryKey: "insurance", tag: "Insurance" },
  money: { categoryKey: "bank-fees" },
  "govt.ato": { categoryKey: "government-tax", tag: "ATO" },
  "govt.hecs-help": { categoryKey: "government-tax", tag: "HECS-HELP" },
  "govt.fines": { categoryKey: "government-tax", tag: "Fines" },
  govt: { categoryKey: "government-tax" },
  "income.salary": { categoryKey: "salary", tag: "Salary" },
  "income.business": { categoryKey: "other-income", tag: "Business" },
  "income.government-benefit": { categoryKey: "other-income", tag: "Government Benefit" },
  "income.rebate": { categoryKey: "other-income", tag: "Rebate" },
  "income.interest": { categoryKey: "other-income", tag: "Interest Earned" },
  "income.dividends": { categoryKey: "other-income", tag: "Dividends" },
  "income.rent-received": { categoryKey: "other-income", tag: "Rent Received" },
  "income.other": { categoryKey: "other-income", tag: "Other Income" },
  income: { categoryKey: "other-income" },
  "debt.drawdown": { categoryKey: "debt-payments", tag: "Drawdown" },
  "debt.loan-repayment": { categoryKey: "debt-payments", tag: "Loan Repayment" },
  "debt.credit-card-payment": { categoryKey: "debt-payments", tag: "Credit Card Payment" },
  "debt.bnpl": { categoryKey: "debt-payments", tag: "Buy Now Pay Later" },
  debt: { categoryKey: "debt-payments" },
  "invest.contribution": { categoryKey: "invest", tag: "Contribution" },
  "invest.brokerage-fee": { categoryKey: "invest", tag: "Brokerage Fee" },
  "invest.super": { categoryKey: "invest", tag: "Super" },
};

/**
 * The old thirteen tags, mapped to where they now live.
 *
 * Two cannot be mapped on their wording alone and are deliberately absent: Income, which
 * was applied to payments as well as receipts, and Goals, which was never a category —
 * `categorize.ts` handed it out for anything reading like a transfer, so it means "the
 * reader thought this was internal" and belongs to the pairing layer, not here.
 */
const LEGACY: Record<string, string> = {
  housing: "rent-mortgage",
  groceries: "groceries",
  dining: "eating-out.restaurants",
  transport: "getting-around",
  shopping: "shopping",
  entertainment: "entertainment",
  subscriptions: "entertainment.streaming",
  utilities: "utilities",
  health: "medical",
  travel: "travel",
  other: OTHER,
};

/** Filing keys the previous taxonomy stored, which a saved category book may still hold. */
export const RETIRED_CATEGORY_KEYS = new Set([
  "food",
  "home",
  "health",
  "leisure",
  "people",
  "money",
  "govt",
  "income",
  "debt",
  "transport",
]);

/** Where an old tag lands, or null when only the movement itself can settle it. */
export function categoryForLegacyTag(tag: string): string | null {
  return LEGACY[tag.trim().toLowerCase()] ?? null;
}

function titleCase(value: string): string {
  return value
    .replace(/[.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function uniquePairs(pairs: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const result: Suggestion[] = [];
  for (const [slug, name] of pairs) {
    const label = name.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([slug, label]);
  }
  return result;
}
