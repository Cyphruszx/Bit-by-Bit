/**
 * Amend BV Rev 3.1 part 1. Spent bars are filed money out. Cash tiles stay
 * Money in − Money out. The old Net, Calculated Spending, and Actual Savings
 * figures are gone. Transfers, investing, and loan payments sit in Money moves.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { applyBook, bookForLedger, defaultCategoryBook, legacyCategoryBook, resolveBook } from "./category-book";
import { categorize } from "./categorize";
import * as dashboard from "./dashboard";
import { classifyKnownInternalTransfer } from "./internal-transfers";
import { adoptStarterList, EMPTY_LEDGER, mergeLedgers, resetStarterTestData, type Ledger } from "./ledger";
import {
  PRELAUNCH_STARTER_RESET,
  STARTER_CATEGORY_MIGRATION,
  STARTER_LIST_VERSION,
  needsStarterReset,
  starterListVersionOf,
} from "./starter-list";
import { isFiledMoneyOut, isSpending, spendByCategory, summarizeMoneyFlow } from "./summary";
import { categoryLabel, splitSuggestion, typeForCategory } from "./taxonomy";
import type { InterpretedTransaction } from "./types";

afterEach(() => {
  applyBook(null);
});

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount">,
): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: "2026-03-06",
    dateIso: "2026-03-06",
    type: over.amount > 0 ? "earned" : "spent",
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

function filed(category: string | null): string {
  return splitSuggestion(category ?? "").categoryKey;
}

describe("Amend BV cash tiles stay Money in minus Money out", () => {
  it("keeps cashNet, Money in, Money out, and drops the old figures", () => {
    applyBook(defaultCategoryBook());
    const shop = txn({ id: "shop", amount: -40, categoryKey: "groceries", type: "spent" });
    const refund = txn({
      id: "back",
      amount: 10,
      categoryKey: "groceries",
      type: "returned",
      refundPair: "shop~back",
      bank: { type: "Refund" },
    });
    shop.refundPair = "shop~back";
    const rows = [
      txn({ id: "pay", amount: 3000, categoryKey: "salary", type: "earned" }),
      txn({ id: "loan", amount: 25000, categoryKey: "debt-payments", type: "borrowed" }),
      shop,
      refund,
      txn({
        id: "out",
        amount: -400,
        categoryKey: "transfers",
        type: "TRANSFER",
        transferPair: "pair",
      }),
      txn({
        id: "in",
        amount: 400,
        categoryKey: "transfers",
        type: "TRANSFER",
        transferPair: "pair",
      }),
    ];
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 28010);
    assert.equal(flow.cashOut, 40);
    assert.equal(flow.cashNet, 27970);
    assert.equal(flow.cashNet, flow.cashIn - flow.cashOut);
    assert.equal(flow.income, 0, "a category and a type do not count as income");
    assert.equal(flow.refunds, 10);
    assert.equal(
      flow.categories.reduce((sum, row) => sum + row.amount, 0),
      40,
      "the refund is not netted out of spent",
    );
    assert.equal("spending" in flow, false);
    assert.equal("net" in flow, false);
    assert.equal("actualSavings" in flow, false);
    assert.equal("monthlyNetDelta" in dashboard, false);
  });

  it("(b) reads spent from filed money out and no longer ships the old tiles", () => {
    applyBook(defaultCategoryBook());
    const groceries = txn({
      id: "g",
      amount: -12,
      categoryKey: "groceries",
      type: "TRANSFER",
    });
    assert.equal(isSpending(groceries), false);
    assert.equal(isFiledMoneyOut(groceries), true, "spent ignores movement kind");
    assert.equal(spendByCategory([groceries])[0]?.amount, 12);

    const bars = readFileSync("src/components/budget-bars.tsx", "utf8");
    const dashboardView = readFileSync("src/app/(app)/dashboard/dashboard-view.tsx", "utf8");
    const savingsView = readFileSync("src/app/(app)/savings/savings-view.tsx", "utf8");
    assert.match(bars, /Last month \(money out\)/);
    assert.equal(dashboardView.includes("flow.net"), false);
    assert.equal(dashboardView.includes("flow.spending"), false);
    assert.equal(dashboardView.includes("actualSavings"), false);
    assert.match(dashboardView, /cashNet/);
    assert.equal(savingsView.includes("Actual Savings"), false);
  });

  it("(c) shows Not sorted yet money out on the bars", () => {
    applyBook(defaultCategoryBook());
    const row = txn({ id: "wait", amount: -25, categoryKey: "uncategorised", type: "spent" });
    const [bar] = spendByCategory([row]);
    assert.equal(bar?.name, "unsorted");
    assert.equal(bar?.amount, 25);
  });
});

describe("Amend BV money moves and interest", () => {
  it("(d) files a detected transfer under Transfers; loan and invest count as money out", () => {
    applyBook(defaultCategoryBook());
    const transfer = classifyKnownInternalTransfer(
      txn({ id: "move", amount: -30, type: "TRANSFER", categoryKey: "uncategorised" }),
    );
    assert.equal(transfer.categoryKey, "transfers");
    assert.equal(transfer.type, "TRANSFER");
    assert.equal(isFiledMoneyOut(transfer), false);

    const nabDebit = classifyKnownInternalTransfer(
      txn({
        id: "nab",
        amount: -80,
        type: "spent",
        categoryKey: "uncategorised",
        bank: { type: "TRANSFER DEBIT" },
      }),
    );
    assert.equal(nabDebit.type, "spent", "NAB TRANSFER DEBIT stays in cash until it is paired");
    assert.equal(nabDebit.categoryKey, "uncategorised");

    assert.equal(filed(categorize("PLENTI REPAYMENT", -220)), "debt-payments");
    assert.equal(filed(categorize("VANGUARD BUY", -50)), "invest");
    assert.equal(isFiledMoneyOut(txn({ id: "loan", amount: -220, categoryKey: "debt-payments", type: "repaid" })), true);
    assert.equal(isFiledMoneyOut(txn({ id: "inv", amount: -50, categoryKey: "invest", type: "invested" })), true);

    const loanCash = summarizeMoneyFlow([
      txn({ id: "loan", amount: -220, categoryKey: "debt-payments", type: "repaid" }),
      txn({ id: "shop", amount: -15, categoryKey: "groceries", type: "spent" }),
    ]);
    assert.equal(loanCash.cashOut, 235, "a loan payment still leaves the account");
    assert.equal(loanCash.categories.reduce((sum, row) => sum + row.amount, 0), 235, "Money moves now shows in the spent bars");
  });

  it("files interest charged to Bank Fees and interest earned to Other Income, not income", () => {
    applyBook(defaultCategoryBook());
    assert.equal(filed(categorize("INTEREST CHARGED", -2.4)), "bank-fees");
    assert.equal(categorize("INTEREST CHARGED", -2.4), "bank-fees.interest-charged");
    assert.equal(filed(categorize("CREDIT INTEREST", 1.15)), "other-income");
    assert.equal(categorize("CREDIT INTEREST", 1.15), "other-income.interest-earned");
    assert.equal(filed(categorize("SOCIETYONE INTEREST", -8)), "bank-fees");
    assert.equal(typeForCategory("other-income", 1.15), "UNREVIEWED");

    const earned = txn({
      id: "in",
      amount: 1.15,
      categoryKey: "other-income",
      type: "UNREVIEWED",
      merchant: "Credit interest",
    });
    assert.equal(summarizeMoneyFlow([earned]).income, 0);
    assert.equal(summarizeMoneyFlow([earned]).cashIn, 1.15);
    const marked = {
      ...earned,
      verdict: { because: "earned" as const, counts: true, at: "2026-03-06T00:00:00.000Z" },
    };
    assert.equal(summarizeMoneyFlow([marked]).income, 1.15);

    const charged = txn({
      id: "fee",
      amount: -2.4,
      categoryKey: "bank-fees",
      type: "spent",
      merchant: "Interest charged",
    });
    const [bar] = spendByCategory([charged]);
    assert.equal(bar?.name, "admin");
    assert.equal(bar?.amount, 2.4);
  });
});

describe("Amend BV starter list", () => {
  it("ships 14 groups and every category named in the table", () => {
    const book = defaultCategoryBook();
    assert.equal(book.starterListVersion, STARTER_LIST_VERSION);
    assert.equal(book.groups.length, 14);
    assert.equal(book.categories.length, 29);
    assert.equal(book.groups.find((group) => group.id === "money-moves")?.label, "Money moves");
    assert.equal(book.groups.find((group) => group.id === "food")?.label, "Food & Drink");
    for (const key of ["streaming", "software-apps", "clothing", "household-electronics", "transfers", "invest", "debt-payments"]) {
      assert.ok(book.categories.some((category) => category.key === key), key);
    }
    assert.equal(categoryLabel("donations"), "Gifts & Donations");
    assert.equal(book.categories.find((category) => category.key === "transfers")?.outType, "moved");
    assert.equal(book.categories.some((category) => category.key === "shopping"), false);
  });

  it("prompts on an older list, and Not now does not load the new one", () => {
    assert.equal(PRELAUNCH_STARTER_RESET, true);
    const old = {
      ...EMPTY_LEDGER,
      imports: [{ id: "imp" }],
      rules: { shop: { categoryKey: "groceries" } },
      payers: { acme: "Acme" },
    } as unknown as Ledger;
    assert.equal(starterListVersionOf(old), 1);
    assert.equal(needsStarterReset(old), true);
    assert.equal(needsStarterReset(old, false), false);
    assert.equal(needsStarterReset(EMPTY_LEDGER), false);
    assert.equal(starterListVersionOf(EMPTY_LEDGER), STARTER_LIST_VERSION);

    const kept = bookForLedger(old);
    assert.equal(kept.starterListVersion, 1);
    assert.ok(kept.categories.some((category) => category.key === "shopping"));
    assert.equal(kept.categories.some((category) => category.key === "clothing"), false);

    const fresh = bookForLedger(EMPTY_LEDGER);
    assert.equal(fresh.categories.some((category) => category.key === "clothing"), true);
    assert.equal(adoptStarterList(EMPTY_LEDGER).starterListVersion, STARTER_LIST_VERSION);
    assert.equal(adoptStarterList(old), old);

    const prompt = readFileSync("src/components/starter-reset-prompt.tsx", "utf8");
    assert.match(prompt, /Starter categories updated\. Reset test data\?/);
    assert.match(prompt, /Reset/);
    assert.match(prompt, /Not now/);
  });

  it("reset clears test data and loads the new list, and does not run the old map", () => {
    const old = {
      ...EMPTY_LEDGER,
      imports: [{ id: "imp" }],
      entries: [{ fingerprint: "row", importIds: ["imp"], categoryKey: "shopping", amount: -12 }],
      rules: { shop: { categoryKey: "shopping" } },
      payers: { acme: "Acme" },
      verdicts: { wage: { because: "earned" } },
      review: [{ id: "open" }],
      institutions: { stmt: "NAB" },
      accounts: { everyday: "Everyday" },
      starterListVersion: 1,
    } as unknown as Ledger;
    assert.equal(STARTER_CATEGORY_MIGRATION.shopping, "household-electronics");
    const resolved = resolveBook(legacyCategoryBook(), 1);
    assert.ok(resolved.categories.some((category) => category.key === "shopping"));
    assert.equal(
      old.entries.some((entry) => entry.categoryKey === "shopping"),
      true,
      "the map is not applied to stored rows",
    );

    const reset = resetStarterTestData(old);
    assert.equal(reset.entries.length, 0);
    assert.equal(reset.imports.length, 0);
    assert.equal(reset.rules, undefined);
    assert.equal(reset.payers, undefined);
    assert.equal(reset.verdicts, undefined);
    assert.equal(reset.review, undefined);
    assert.equal(reset.institutions?.stmt, "NAB");
    assert.equal(reset.accounts?.everyday, "Everyday");
    assert.equal(reset.starterListVersion, STARTER_LIST_VERSION);
    assert.ok(reset.taxonomy?.categories.some((category) => category.key === "streaming"));
    assert.equal(needsStarterReset(reset), false);
    assert.equal(mergeLedgers(old, EMPTY_LEDGER).starterListVersion, 1);
  });

  it("matches the new starter categories, and only subscription billing for software", () => {
    assert.equal(filed(categorize("NETFLIX.COM", -15.99)), "streaming");
    assert.equal(filed(categorize("STAN.COM.AU", -12)), "streaming");
    assert.equal(filed(categorize("SPOTIFY", -11.99)), "streaming");
    assert.equal(filed(categorize("APPLE.COM/BILL", -14.99)), "software-apps");
    assert.equal(filed(categorize("GOOGLE PLAY", -4.99)), "software-apps");
    assert.equal(filed(categorize("APPLE STORE BOND", -49)), "household-electronics");
    assert.notEqual(filed(categorize("APPLE STORE BOND", -49)), "software-apps");
    assert.equal(filed(categorize("UNIQLO SYDNEY", -40)), "clothing");
    assert.equal(filed(categorize("OFFICEWORKS", -22)), "household-electronics");
    assert.equal(filed(categorize("RED CROSS", -20)), "donations");
  });
});
