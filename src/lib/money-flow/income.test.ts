import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { incomeSources, unsettledIncome } from "./income";
import { interpretDocuments } from "./interpret";
import { summarizeMoneyFlow } from "./summary";
import { markTransferLegs } from "./transfers";
import type { InterpretedTransaction, TransactionType } from "./types";

let made = 0;

function credit(amount: number, type: TransactionType, over: Partial<InterpretedTransaction> = {}) {
  made += 1;
  return {
    id: `m${made}`,
    merchant: "Something",
    category: "Other",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type,
    sourceFile: "nab.csv",
    accountId: "NAB · 100200300",
    confidence: 1,
    ...over,
  } satisfies InterpretedTransaction;
}

describe("saying where money in came from", () => {
  it("splits the figure by how sure the reader is", () => {
    const sources = incomeSources([
      credit(3000, "income"),
      credit(500, "income"),
      credit(1200, "refund"),
      credit(25000, "transfer"),
      credit(-90, "expense"),
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
    const rows = [credit(3000, "income"), credit(1200, "refund"), credit(25000, "transfer"), credit(-90, "expense")];
    const explained = incomeSources(rows).reduce((sum, source) => sum + source.amount, 0);

    assert.equal(explained, summarizeMoneyFlow(rows).income);
  });

  it("leaves out money that already cancelled, because it is not in the figure", () => {
    const rows = [
      credit(3000, "income"),
      credit(80, "refund", { refundPair: "a~b" }),
      credit(-80, "expense", { id: "paid", refundPair: "a~b" }),
      credit(500, "transfer", { transferPair: "c~d" }),
      credit(-500, "transfer", { id: "sent", transferPair: "c~d", accountId: "NAB · 400500600" }),
    ];

    assert.deepEqual(incomeSources(rows).map((source) => source.kind), ["earned"]);
    assert.equal(unsettledIncome(rows), 0);
  });

  it("counts a movement the reader could not type at all as earnings", () => {
    const sources = incomeSources([credit(90, "expense", { amount: 90 })]);
    assert.deepEqual(sources.map((source) => [source.kind, source.amount]), [["earned", 90]]);
  });

  it("says nothing about a scope with no money in", () => {
    assert.deepEqual(incomeSources([credit(-90, "expense")]), []);
  });

  it("counts only what a person could still argue with", () => {
    const rows = [credit(3000, "income"), credit(1200, "refund"), credit(25000, "transfer")];
    assert.equal(unsettledIncome(rows), 26200);
  });
});

describe("the samples, split up", () => {
  it("shows the household its Medicare billing and its loan separately", async () => {
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
    const rows = markTransferLegs(result.transactions);
    const sources = incomeSources(rows);
    const of = (kind: string) => sources.find((source) => source.kind === kind);

    // $167,796.02 of money in, and only $17,482.09 of it is what a person would call
    // earnings. The rest is a practice's Medicare billing NAB files under "Refund" and a
    // $25,000 SocietyOne drawdown NAB calls a transfer.
    assert.equal(of("earned")?.amount, 17482.09);
    assert.equal(of("returned")?.amount, 124812.93);
    assert.equal(of("arrived")?.amount, 25501);
    assert.equal(
      sources.reduce((sum, source) => sum + source.amount, 0),
      summarizeMoneyFlow(rows).income,
    );
    assert.equal(unsettledIncome(rows), 150313.93);
  });
});
