import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { incomeSources, unsettledGroups, unsettledIncome } from "./income";
import { interpretDocuments } from "./interpret";
import { roundMoney } from "./parse-values";
import { summarizeMoneyFlow } from "./summary";
import { markTransferLegs } from "./transfers";
import { applyVerdicts, likeKey, verdictFor } from "./verdicts";
import type { InterpretedTransaction } from "./types";

let made = 0;

/**
 * A movement and the label its bank put on it.
 *
 * The split is made on the bank's own wording rather than on a type, because these are the
 * credits the reader has already failed to place: no payment was reversed and no other leg
 * was found, so what the bank claimed is the only new thing left to put to the person.
 */
function credit(amount: number, called: string, over: Partial<InterpretedTransaction> = {}) {
  made += 1;
  return {
    id: `m${made}`,
    merchant: "Something",
    categoryKey: "uncategorised",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type: amount > 0 ? "earned" : "spent",
    bank: { category: called },
    sourceFile: "nab.csv",
    accountId: "NAB · 100200300",
    confidence: 1,
    ...over,
  } satisfies InterpretedTransaction;
}

describe("saying where money in came from", () => {
  it("splits the figure by how sure the reader is", () => {
    const sources = incomeSources([
      credit(3000, "Salary"),
      credit(500, "Salary"),
      credit(1200, "Refund"),
      credit(25000, "Transfers in"),
      credit(-90, "Groceries"),
    ]);

    assert.deepEqual(
      sources.map((source) => [source.kind, source.amount, source.count]),
      [
        ["earned", 3500, 2],
        ["returned", 1200, 1],
        ["arrived", 25000, 1],
      ],
    );
  });

  it("adds back up to the money-in figure it explains", () => {
    const rows = [credit(3000, "Salary"), credit(1200, "Refund"), credit(25000, "Transfers in"), credit(-90, "Groceries")];
    const explained = incomeSources(rows).reduce((sum, source) => sum + source.amount, 0);

    assert.equal(explained, summarizeMoneyFlow(rows).income);
  });

  it("leaves out money that already cancelled, because it is not in the figure", () => {
    const rows = [
      credit(3000, "Salary"),
      credit(80, "Refund", { refundPair: "a~b" }),
      credit(-80, "Groceries", { id: "paid", refundPair: "a~b" }),
      credit(500, "Transfers in", { transferPair: "c~d" }),
      credit(-500, "Transfers out", { id: "sent", transferPair: "c~d", accountId: "NAB · 400500600" }),
    ];

    assert.deepEqual(incomeSources(rows).map((source) => source.kind), ["earned"]);
    assert.equal(unsettledIncome(rows), 0);
  });

  it("counts a credit the bank said nothing useful about as earnings", () => {
    const sources = incomeSources([credit(90, "Groceries", { amount: 90 })]);
    assert.deepEqual(sources.map((source) => [source.kind, source.amount]), [["earned", 90]]);
  });

  it("says nothing about a scope with no money in", () => {
    assert.deepEqual(incomeSources([credit(-90, "Groceries")]), []);
  });

  it("counts only what a person could still argue with", () => {
    const rows = [credit(3000, "Salary"), credit(1200, "Refund"), credit(25000, "Transfers in")];
    assert.equal(unsettledIncome(rows), 26200);
  });
});

describe("the samples, split up", () => {
  async function sampleLedger() {
    const dir = path.join(process.cwd(), "public/samples");
    const names = ["nab-medicare.csv", "nab-rent.csv", "up-2025-07-to-2026-06.txt"];
    const result = await interpretDocuments(
      names.map((filename) => ({
        filename,
        mime: filename.endsWith(".csv") ? "text/csv" : "text/plain",
        bytes: new Uint8Array(readFileSync(path.join(dir, filename))),
      })),
      { ai: null },
    );
    return markTransferLegs(result.transactions);
  }

  it("shows the household its Medicare billing, the loan having already been placed", async () => {
    const rows = await sampleLedger();
    const sources = incomeSources(rows);
    const of = (kind: string) => sources.find((source) => source.kind === kind);

    // $142,796.02 of money in, and only $17,482.09 of it is what a person would call
    // earnings. Nearly all the rest is a practice's Medicare billing, which NAB files
    // under "Refund".
    //
    // The $25,000 SocietyOne drawdown is no longer in here at all, and that is the point:
    // it used to be the second-biggest thing the person had to explain, and the reader now
    // recognises a consumer lender and types it as borrowing on its own. "Arrived" is down
    // to $501 of genuinely unexplained credits.
    assert.equal(of("earned")?.amount, 17482.09);
    assert.equal(of("returned")?.amount, 124812.93);
    assert.equal(of("arrived")?.amount, 501);
    assert.equal(
      sources.reduce((sum, source) => sum + source.amount, 0),
      summarizeMoneyFlow(rows).income,
    );
    assert.equal(unsettledIncome(rows), 125313.93);
  });

  it("puts a year of unplaced money to the person as six questions", async () => {
    const rows = await sampleLedger();
    const groups = unsettledGroups(rows);

    // Biggest first, because the top one is 96% of it and is a single click. The loan that
    // used to sit second is gone from the list: the reader places it without asking.
    assert.equal(groups.length, 6);
    assert.equal(groups[0].count, 172, "a year of Medicare billing asked about once");
    assert.equal(groups[0].amount, 120844.2);
    assert.match(groups[0].label, /MCARE BENEFITS/);
    assert.ok(!groups.some((group) => /SocietyOne/.test(group.label)), "the drawdown needs no answer");
    assert.equal(groups[1].amount, 3964, "four ATO refunds, which are money in and stay in");
    assert.equal(
      roundMoney(groups.reduce((sum, group) => sum + group.amount, 0)),
      unsettledIncome(rows),
    );
  });

  it("reaches the household's real position once the billing is answered", async () => {
    const rows = await sampleLedger();
    const groups = unsettledGroups(rows);
    const at = "2026-09-03T00:00:00.000Z";
    // One answer now, not two. The practice's billing is revenue, and it is the only thing
    // left that a statement could never have settled by itself.
    const settled = applyVerdicts(rows, {
      [likeKey(groups[0].example)]: verdictFor("earned", at),
    });
    const flow = summarizeMoneyFlow(settled);

    assert.equal(flow.income, 142796.02, "the loan was already out, and the billing stays");
    assert.equal(flow.spending, 168303.53, "no payment changed");
    assert.equal(flow.net, -25507.51, "which is what living on a $25,000 loan looks like");
    assert.equal(flow.cashNet, -507.51, "and the cash that moved is untouched");
    assert.equal(unsettledIncome(settled), 4469.73);
  });
});
