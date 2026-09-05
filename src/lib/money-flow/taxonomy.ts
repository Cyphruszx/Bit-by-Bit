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
 * what the money was for. A **tag** is anything else the person wants to find it by, and
 * never moves a total.
 *
 * Type is derived rather than stored twice: a category knows which type it takes on the
 * way in and which on the way out, so "Medicare" as a payment is health spending and
 * "Medicare" as a receipt is income, from one rule.
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
// Categories
// ---------------------------------------------------------------------------

type Group = {
  key: string;
  label: string;
  /** The type a credit in this group takes. */
  inType: TransactionType;
  /** The type a debit in this group takes. */
  outType: TransactionType;
  /** Machine keys, without the group prefix. Display names are derived from these. */
  children: string[];
};

/**
 * Twelve groups a person can hold in their head, each with a handful of children. Two
 * levels exactly: the charts already drill from a group to its children, and a third level
 * would have nothing to draw.
 *
 * Every spending group takes `earned` on the way in, which looks wrong until you try the
 * alternative. Typing a credit `returned` because it landed in a spending category means a
 * rule that mis-files one credit silently deletes it from income — four ATO refunds worth
 * $3,964 vanished from the sample statements that way, and nothing on screen would have
 * said so. So `moved` and `returned` are only ever *proved*: written by the matcher that
 * found the other leg or the payment being reversed, or by the person saying so. A credit
 * sitting under Groceries is a rule getting it wrong, and it still counts until somebody
 * fixes the category.
 */
const GROUPS: Group[] = [
  {
    key: "home",
    label: "Home",
    inType: "earned",
    outType: "spent",
    children: ["rent", "mortgage-interest", "strata", "council-rates", "maintenance", "insurance", "furniture"],
  },
  {
    key: "utilities",
    label: "Utilities",
    inType: "earned",
    outType: "spent",
    children: ["electricity", "gas", "water", "internet", "mobile"],
  },
  {
    key: "food",
    label: "Food & Drink",
    inType: "earned",
    outType: "spent",
    children: ["groceries", "restaurants", "takeaway", "coffee", "alcohol"],
  },
  {
    key: "transport",
    label: "Transport",
    inType: "earned",
    outType: "spent",
    children: ["fuel", "public-transport", "rideshare", "parking-tolls", "rego-ctp", "servicing", "insurance"],
  },
  {
    key: "health",
    label: "Health",
    inType: "earned",
    outType: "spent",
    children: ["gp-specialist", "pharmacy", "dental", "optical", "private-cover", "fitness"],
  },
  {
    key: "shopping",
    label: "Shopping",
    inType: "earned",
    outType: "spent",
    children: ["clothing", "homewares", "electronics", "hobbies", "gifts"],
  },
  {
    key: "leisure",
    label: "Leisure",
    inType: "earned",
    outType: "spent",
    children: ["streaming", "software", "events", "gaming", "sport"],
  },
  {
    key: "travel",
    label: "Travel",
    inType: "earned",
    outType: "spent",
    children: ["flights", "accommodation", "transport-abroad", "insurance"],
  },
  {
    key: "people",
    label: "Family & Personal",
    inType: "earned",
    outType: "spent",
    children: ["childcare", "education", "pets", "personal-care", "donations"],
  },
  {
    key: "money",
    label: "Fees & Interest",
    inType: "earned",
    outType: "spent",
    children: ["bank-fees", "interest-charged", "foreign-fees", "professional-fees", "insurance"],
  },
  {
    key: "govt",
    label: "Government & Tax",
    inType: "earned",
    outType: "spent",
    children: ["ato", "hecs-help", "fines"],
  },
  {
    key: "income",
    label: "Income",
    inType: "earned",
    // A payment filed under income is a salary reversal or a reading that went wrong, and
    // is neither spending nor a category to fix silently.
    outType: "adjusted",
    children: [
      "salary",
      "business",
      "government-benefit",
      "rebate",
      "interest",
      "dividends",
      "rent-received",
      "other",
    ],
  },
  {
    key: "debt",
    label: "Borrowing",
    inType: "borrowed",
    outType: "repaid",
    children: ["drawdown", "loan-repayment", "credit-card-payment", "bnpl"],
  },
  {
    key: "invest",
    label: "Investing",
    inType: "earned",
    outType: "invested",
    children: ["contribution", "brokerage-fee", "super"],
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

const WORDS: Record<string, string> = {
  "mortgage-interest": "Mortgage interest",
  "council-rates": "Council rates",
  "public-transport": "Public transport",
  "parking-tolls": "Parking & tolls",
  "rego-ctp": "Rego & CTP",
  "gp-specialist": "GP & specialists",
  "private-cover": "Private health cover",
  "bank-fees": "Bank fees",
  "interest-charged": "Interest charged",
  "foreign-fees": "Foreign transaction fees",
  "professional-fees": "Professional fees",
  "hecs-help": "HECS-HELP",
  ato: "ATO",
  "government-benefit": "Government benefit",
  "rent-received": "Rent received",
  "transport-abroad": "Transport abroad",
  "personal-care": "Personal care",
  "credit-card-payment": "Credit card payment",
  "loan-repayment": "Loan repayment",
  bnpl: "Buy now pay later",
  "brokerage-fee": "Brokerage fee",
  super: "Super",
};

const BY_GROUP = new Map(GROUPS.map((group) => [group.key, group]));

/** Every category a person can be given, groups first so a chart reads top-down. */
export const CATEGORY_KEYS: string[] = [
  ...GROUPS.flatMap((group) => [group.key, ...group.children.map((child) => `${group.key}.${child}`)]),
  OTHER,
  UNCATEGORISED,
];

const KNOWN = new Set(CATEGORY_KEYS);

export function isCategoryKey(value: unknown): value is string {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * The group a category belongs to. A group is its own group.
 *
 * Tolerant of a missing key on purpose: these run over rows read straight out of storage,
 * and a ledger written before the taxonomy existed should open rather than throw.
 */
export function groupOf(key: string | undefined): string {
  if (!key) return UNCATEGORISED;
  return key.includes(".") ? key.slice(0, key.indexOf(".")) : key;
}

/** The part after the dot, or an empty string for a group. */
export function childOf(key: string | undefined): string {
  if (!key) return "";
  return key.includes(".") ? key.slice(key.indexOf(".") + 1) : "";
}

export function categoryLabel(key: string | undefined): string {
  if (!key) return LOOSE[UNCATEGORISED].label;
  const loose = LOOSE[key];
  if (loose) return loose.label;
  const group = BY_GROUP.get(groupOf(key));
  if (!group) return titleCase(key);
  const child = childOf(key);
  if (!child) return group.label;
  return WORDS[child] ?? titleCase(child);
}

/** "Food & Drink · Groceries", for the places that show a category on its own. */
export function categoryPath(key: string | undefined): string {
  const child = childOf(key);
  if (!child || !key || LOOSE[key]) return categoryLabel(key);
  return `${categoryLabel(groupOf(key))} · ${categoryLabel(key)}`;
}

/**
 * The type a category takes in this direction.
 *
 * This is the whole reason the two layers are separate. One rule recognises Medicare, and
 * the direction decides whether that is a payment to a doctor or a benefit arriving — the
 * old model had to guess from the merchant alone and got it wrong in both directions.
 */
export function typeForCategory(key: string | undefined, amount: number): TransactionType {
  const loose = key ? LOOSE[key] : undefined;
  const group = loose ?? BY_GROUP.get(groupOf(key)) ?? LOOSE[UNCATEGORISED];
  return amount > 0 ? group.inType : group.outType;
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
