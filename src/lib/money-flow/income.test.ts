import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { incomeSources, unsettledGroups, unsettledIncome } from "./income";
import { interpretDocuments } from "./interpret";
import { roundMoney } from "./parse-values";
import { summarizeMoneyFlow } from "./summary";
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
      [["earned", 3500, 2]],
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
    assert.equal(unsettledIncome(rows), 0, "OPEN refund and transfer credits are not in the income figure");
  });

  it("does not ask about a refund the rules already filed as income", () => {
    const rows = [
      credit(662.4, "Refund", { categoryKey: "other-income", decidedBy: "rules", merchant: "Medicare" }),
      credit(1200, "Refund"),
    ];
    const sources = incomeSources(rows);
    assert.deepEqual(
      sources.map((source) => [source.kind, source.amount, source.askable]),
      [["earned", 662.4, false]],
    );
    assert.equal(unsettledIncome(rows), 0);
    assert.equal(unsettledGroups(rows).length, 0);
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
    return result.transactions;
  }

  it("files the practice's billing under earned, and only asks about what is still unsorted", async () => {
    const rows = await sampleLedger();
    const sources = incomeSources(rows);
    const of = (kind: string) => sources.find((source) => source.kind === kind);

    // Medicare ($120,844.20) and the ATO rebates sit under Earned. SocietyOne is borrowed.
    // Unlinked refund-shaped credits are not Income (Spec 10). OPEN unpaired transfers
    // are held out of Income (Spec 7), so the income card has nothing left to ask about.
    assert.equal(of("earned")?.amount, 145096.99);
    assert.equal(of("returned"), undefined);
    assert.equal(of("arrived"), undefined);
    assert.equal(
      roundMoney(sources.reduce((sum, source) => sum + source.amount, 0)),
      summarizeMoneyFlow(rows).income,
    );
    assert.equal(unsettledIncome(rows), 0);
  });

  it("does not keep leftover transfers in the income card once they are OPEN", async () => {
    const rows = await sampleLedger();
    assert.equal(unsettledGroups(rows).length, 0);
    assert.equal(summarizeMoneyFlow(rows).income, 145096.99);
    assert.equal(summarizeMoneyFlow(rows).cashNet, -507.51);
  });
});
