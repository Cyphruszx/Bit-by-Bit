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
 * There are fourteen categories and they are flat. An earlier draft had a second level —
 * `food.groceries` under `food` — and it bought nothing: every figure in the app was
 * already summed at the top level, so the depth existed only to be collapsed again. The
 * detail is worth keeping, so those seventy-four names are the tag vocabulary instead,
 * offered against the category they belong to. One movement, one category, any number of
 * tags.
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
 * Fourteen categories a person can hold in their head, each with a handful of tags to
 * reach for.
 *
 * Every category takes `earned` on the way in, which looks wrong until you try the
 * alternative. Typing a credit `returned` because it landed in a spending category means a
 * rule that mis-files one credit silently deletes it from income — four ATO refunds worth
 * $3,964 vanished from the sample statements that way, and nothing on screen would have
 * said so. So `moved` and `returned` are only ever *proved*: written by the matcher that
 * found the other leg or the payment being reversed, or by the person saying so. A credit
 * sitting under Groceries is a rule getting it wrong, and it still counts until somebody
 * fixes the category.
 */
const CATEGORIES: Category[] = [
  {
    key: "home",
    label: "Home",
    inType: "earned",
    outType: "spent",
    tags: [
      ["rent", "Rent"],
      ["mortgage-interest", "Mortgage Interest"],
      ["strata", "Strata"],
      ["council-rates", "Council Rates"],
      ["maintenance", "Maintenance"],
      ["insurance", "Home Insurance"],
      ["furniture", "Furniture"],
    ],
  },
  {
    key: "utilities",
    label: "Utilities",
    inType: "earned",
    outType: "spent",
    tags: [
      ["electricity", "Electricity"],
      ["gas", "Gas"],
      ["water", "Water"],
      ["internet", "Internet"],
      ["mobile", "Mobile"],
    ],
  },
  {
    key: "food",
    label: "Food & Drink",
    inType: "earned",
    outType: "spent",
    tags: [
      ["groceries", "Groceries"],
      ["restaurants", "Restaurants"],
      ["takeaway", "Takeaway"],
      ["coffee", "Coffee"],
      ["alcohol", "Alcohol"],
    ],
  },
  {
    key: "transport",
    label: "Transport",
    inType: "earned",
    outType: "spent",
    tags: [
      ["fuel", "Fuel"],
      ["public-transport", "Public Transport"],
      ["rideshare", "Rideshare"],
      ["parking-tolls", "Parking & Tolls"],
      ["rego-ctp", "Rego & CTP"],
      ["servicing", "Servicing"],
      ["insurance", "Car Insurance"],
    ],
  },
  {
    key: "health",
    label: "Health",
    inType: "earned",
    outType: "spent",
    tags: [
      ["gp-specialist", "GP & Specialists"],
      ["pharmacy", "Pharmacy"],
      ["dental", "Dental"],
      ["optical", "Optical"],
      ["private-cover", "Private Health Cover"],
      ["fitness", "Fitness"],
    ],
  },
  {
    key: "shopping",
    label: "Shopping",
    inType: "earned",
    outType: "spent",
    tags: [
      ["clothing", "Clothing"],
      ["homewares", "Homewares"],
      ["electronics", "Electronics"],
      ["hobbies", "Hobbies"],
      ["gifts", "Gifts"],
    ],
  },
  {
    key: "leisure",
    label: "Leisure",
    inType: "earned",
    outType: "spent",
    tags: [
      ["streaming", "Streaming"],
      ["software", "Software"],
      ["events", "Events"],
      ["gaming", "Gaming"],
      ["sport", "Sport"],
    ],
  },
  {
    key: "travel",
    label: "Travel",
    inType: "earned",
    outType: "spent",
    tags: [
      ["flights", "Flights"],
      ["accommodation", "Accommodation"],
      ["transport-abroad", "Transport Abroad"],
      ["insurance", "Travel Insurance"],
    ],
  },
  {
    key: "people",
    label: "Family & Personal",
    inType: "earned",
    outType: "spent",
    tags: [
      ["childcare", "Childcare"],
      ["education", "Education"],
      ["pets", "Pets"],
      ["personal-care", "Personal Care"],
      ["donations", "Donations"],
    ],
  },
  {
    key: "money",
    label: "Fees & Interest",
    inType: "earned",
    outType: "spent",
    tags: [
      ["bank-fees", "Bank Fees"],
      ["interest-charged", "Interest Charged"],
      ["foreign-fees", "Foreign Transaction Fees"],
      ["professional-fees", "Professional Fees"],
      ["insurance", "Insurance"],
    ],
  },
  {
    key: "govt",
    label: "Government & Tax",
    inType: "earned",
    outType: "spent",
    tags: [
      ["ato", "ATO"],
      ["hecs-help", "HECS-HELP"],
      ["fines", "Fines"],
    ],
  },
  {
    key: "income",
    label: "Income",
    inType: "earned",
    // A payment filed under income is a salary reversal or a reading that went wrong, and
    // is neither spending nor a category to fix silently.
    outType: "adjusted",
    tags: [
      ["salary", "Salary"],
      ["business", "Business"],
      ["government-benefit", "Government Benefit"],
      ["rebate", "Rebate"],
      ["interest", "Interest Earned"],
      ["dividends", "Dividends"],
      ["rent-received", "Rent Received"],
      ["other", "Other Income"],
    ],
  },
  {
    key: "debt",
    label: "Borrowing",
    inType: "borrowed",
    outType: "repaid",
    tags: [
      ["drawdown", "Drawdown"],
      ["loan-repayment", "Loan Repayment"],
      ["credit-card-payment", "Credit Card Payment"],
      ["bnpl", "Buy Now Pay Later"],
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

/** Every category a movement can be filed under. Fourteen, plus the two loose ones. */
export const CATEGORY_KEYS: string[] = [...CATEGORIES.map((category) => category.key), OTHER, UNCATEGORISED];

/**
 * Folders a person reaches for first. The ledger still stores a category, not a group —
 * this is only how the list is offered, so Home and the power bill sit together without
 * inventing a second thing to save.
 */
export const CATEGORY_GROUPS: { key: string; label: string; categories: string[] }[] = [
  { key: "income", label: "Income", categories: ["income"] },
  { key: "housing", label: "Housing", categories: ["home", "utilities"] },
  { key: "food", label: "Food", categories: ["food"] },
  { key: "transport", label: "Transport", categories: ["transport"] },
  { key: "lifestyle", label: "Lifestyle", categories: ["shopping", "leisure", "travel", "people"] },
  { key: "health", label: "Health", categories: ["health"] },
  { key: "commitments", label: "Commitments", categories: ["money", "debt", "invest"] },
  { key: "giving-govt", label: "Giving and Government", categories: ["govt"] },
  { key: "other", label: "Other", categories: [OTHER, UNCATEGORISED] },
];

const GROUP_BY_CATEGORY = new Map(
  CATEGORY_GROUPS.flatMap((group) => group.categories.map((key) => [key, group] as const)),
);

const OTHER_GROUP = CATEGORY_GROUPS[CATEGORY_GROUPS.length - 1];

/** The folder this category sits in. Unknown keys land in Other. */
export function groupOf(categoryKey: string | undefined) {
  return (categoryKey && GROUP_BY_CATEGORY.get(categoryKey)) || OTHER_GROUP;
}

export function groupLabel(categoryKey: string | undefined): string {
  return groupOf(categoryKey).label;
}

/**
 * The category to file under after a folder is chosen.
 *
 * Stay put when the current category already lives there. Otherwise take the first one in
 * the folder — Other, not "Not sorted yet", because moving a row into Other is a decision.
 */
export function defaultCategoryForGroup(groupKey: string, current?: string): string {
  const group = CATEGORY_GROUPS.find((entry) => entry.key === groupKey) ?? OTHER_GROUP;
  if (current && group.categories.includes(current)) return current;
  return group.categories[0];
}

const KNOWN = new Set(CATEGORY_KEYS);

export function isCategoryKey(value: unknown): boolean {
  return typeof value === "string" && KNOWN.has(value);
}

export function categoryLabel(key: string | undefined): string {
  if (!key) return LOOSE[UNCATEGORISED].label;
  return LOOSE[key]?.label ?? BY_KEY.get(key)?.label ?? titleCase(key);
}

/** Kept as its own name because callers mean "however this category should read on its own". */
export function categoryPath(key: string | undefined): string {
  return categoryLabel(key);
}

/** The tags this category offers. Suggestions only — a person can type anything. */
export function tagsFor(categoryKey: string | undefined): string[] {
  return (BY_KEY.get(categoryKey ?? "")?.tags ?? []).map(([, tag]) => tag);
}

/** Every tag the app suggests, for the pickers that are not scoped to one category. */
export const SUGGESTED_TAGS: string[] = [
  ...new Set(CATEGORIES.flatMap((category) => category.tags.map(([, tag]) => tag))),
].sort((a, b) => a.localeCompare(b));

/**
 * Everything a rule or a model may answer with: a category on its own, or a category and
 * one of its tags written as `food.groceries`.
 *
 * The dotted form is kept as a *vocabulary* even though nothing stores it any more. It is
 * how the merchant rules stay legible — one line saying groceries rather than two saying
 * food and then Groceries — and it lets a model answer at the level it is actually sure
 * of, which is usually the specific one.
 */
export const SUGGESTIONS: string[] = [
  ...CATEGORIES.flatMap((category) => [
    category.key,
    ...category.tags.map(([slug]) => `${category.key}.${slug}`),
  ]),
  OTHER,
];

/**
 * Splits what a rule, a model or an older ledger said into the two things it now means.
 *
 * `food.groceries` is a category and a tag, and used to be one key. Reading it apart here
 * is the whole of the migration: every movement stored under the two-level model lands on
 * the category it was already being counted under, and keeps the detail as a tag.
 */
export function splitSuggestion(raw: string | undefined): { categoryKey: string; tag?: string } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { categoryKey: UNCATEGORISED };
  if (!value.includes(".")) {
    return { categoryKey: isCategoryKey(value) ? value : UNCATEGORISED };
  }

  const [head, ...rest] = value.split(".");
  const category = BY_KEY.get(head);
  if (!category) return { categoryKey: isCategoryKey(head) ? head : UNCATEGORISED };

  const slug = rest.join(".");
  const found = category.tags.find(([known]) => known === slug);
  return { categoryKey: category.key, ...(found ? { tag: found[1] } : {}) };
}

/**
 * The type a category takes in this direction.
 *
 * This is the whole reason the two layers are separate. One rule recognises Medicare, and
 * the direction decides whether that is a payment to a doctor or a benefit arriving — the
 * old model had to guess from the merchant alone and got it wrong in both directions.
 */
export function typeForCategory(key: string | undefined, amount: number): TransactionType {
  const held = key ? (LOOSE[key] ?? BY_KEY.get(key)) : undefined;
  const meaning = held ?? LOOSE[UNCATEGORISED];
  return amount > 0 ? meaning.inType : meaning.outType;
}

/**
 * The old thirteen tags, mapped to where they now live.
 *
 * Two cannot be mapped on their wording alone and are deliberately absent: Income, which
 * was applied to payments as well as receipts, and Goals, which was never a category —
 * `categorize.ts` handed it out for anything reading like a transfer, so it means "the
 * reader thought this was internal" and belongs to the pairing layer, not here.
 */
const LEGACY: Record<string, string> = {
  housing: "home",
  groceries: "food.groceries",
  dining: "food.restaurants",
  transport: "transport",
  shopping: "shopping",
  entertainment: "leisure",
  subscriptions: "leisure.streaming",
  utilities: "utilities",
  health: "health",
  travel: "travel",
  other: OTHER,
};

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
