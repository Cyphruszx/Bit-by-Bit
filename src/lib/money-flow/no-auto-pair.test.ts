/**
 * Spec 7 money-trust: Core does not auto-resolve refunds or cross-institution
 * / contested / unknown-institution transfers. Spec 3/7 unique same-institution
 * pairs resolve silently at ingest.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyTagSuggestions } from "./ai";
import { forgetAutoPairs } from "./auto-pairs";
import { interpretDocuments } from "./interpret";
import { markRefundLegs, matchRefunds } from "./refunds";
import { summarizeMoneyFlow } from "./summary";
import { markTransferLegs, matchTransfers } from "./transfers";
import type { InterpretedTransaction } from "./types";

process.env.OPENAI_API_KEY = "";

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  const amount = over.amount;
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? (amount > 0 ? "salary" : "groceries"),
    date: over.dateIso,
    type: over.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: over.sourceFile ?? "demo.csv",
    confidence: 1,
    ...over,
  };
}

describe("Core ingest silent-pairs unique same-institution transfers (Spec 3/7)", () => {
  it("writes a unique NAB pair and does not leave it OPEN", async () => {
    const csv = (account: string, rows: string) =>
      `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On\n${rows.replaceAll("ACCOUNT", account)}`;
    const everyday = csv(
      "100200300",
      "12 Aug 26,-400.00,ACCOUNT,TRANSFER DEBIT,Transfer To Savings,100.00,Internal transfers,Transfer To Savings,12 Aug 26",
    );
    const savings = csv(
      "400500600",
      "12 Aug 26,400.00,ACCOUNT,TRANSFER CREDIT,Transfer From Everyday,500.00,Internal transfers,Transfer From Everyday,12 Aug 26",
    );
    const result = await interpretDocuments([
      { filename: "everyday.csv", mime: "text/csv", bytes: new TextEncoder().encode(everyday) },
      { filename: "savings.csv", mime: "text/csv", bytes: new TextEncoder().encode(savings) },
    ]);

    assert.equal(result.transactions.length, 2);
    assert.ok(result.transactions.every((row) => row.institution === "NAB"));
    assert.ok(result.transactions.every((row) => row.transferPair));
    assert.ok(result.transactions.every((row) => row.type === "TRANSFER"));

    const flow = result.flow;
    assert.equal(flow.transfers, 400);
    assert.equal(flow.income, 0);
    assert.equal(flow.spending, 0);
    assert.equal(flow.cashIn, 0, "classified same-institution pair is omitted from Money in");
    assert.equal(flow.cashOut, 0, "classified same-institution pair is omitted from Money out");
    assert.ok(!flow.insights.some((line) => /likely transfer/i.test(line)));
  });

  it("leaves a cross-institution unique pair OPEN", async () => {
    const nab = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
12 Aug 26,-400.00,100200300,TRANSFER DEBIT,Transfer To Up,100.00,Internal transfers,Transfer To Up,12 Aug 26`;
    const up = `Date,Description,Amount
12 Aug 26,Osko Payment Received,400.00`;
    const result = await interpretDocuments([
      { filename: "nab.csv", mime: "text/csv", bytes: new TextEncoder().encode(nab) },
      { filename: "up-everyday.csv", mime: "text/csv", bytes: new TextEncoder().encode(up) },
    ]);
    assert.ok(result.transactions.some((row) => row.institution === "NAB"));
    assert.ok(result.transactions.some((row) => row.institution === "Up"));
    assert.ok(result.transactions.every((row) => !row.transferPair));
    const detected = matchTransfers(result.transactions);
    assert.equal(detected.pairs.length, 1);
    assert.equal(detected.pairs[0]?.sameInstitution, false);
    assert.equal(result.flow.transfers, 0);
    assert.ok(result.flow.insights.some((line) => /likely transfer/i.test(line)));
  });
});

describe("Core ingest does not auto-write refund pairs", () => {
  it("detects an exact shop refund but does not turn it into Refund credits", async () => {
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
03 Mar 26,-80.00,100200300,,EFTPOS DEBIT,Kmart Wagga,20.00,Shopping,Kmart Wagga,03 Mar 26
04 Mar 26,80.00,100200300,,REFUND,Kmart Wagga,100.00,Refund,Kmart Wagga,04 Mar 26
06 Mar 26,3000.00,100200300,,PAYROLL,Acme Payroll,3100.00,Salary,Acme Payroll,06 Mar 26
`;
    const result = await interpretDocuments([
      { filename: "nab.csv", mime: "text/csv", bytes: new TextEncoder().encode(csv) },
    ]);

    const paid = result.transactions.find((row) => row.amount === -80);
    const back = result.transactions.find((row) => row.amount === 80);
    assert.equal(paid?.refundPair, undefined);
    assert.equal(back?.refundPair, undefined);
    assert.notEqual(back?.type, "returned");
    assert.notEqual(back?.type, "REFUND");

    assert.equal(matchRefunds(result.transactions).pairs.length, 1);

    const flow = result.flow;
    assert.equal(flow.refunds, 0, "unconfirmed refunds are not Refund credits");
    assert.equal(flow.income, 3000, "the credit is not Income either (unlinked refund-shaped)");
    assert.equal(flow.spending, 80, "month-freeze: the original payment stays in Spending");
    assert.equal(flow.net, 3000 - 80);
    assert.ok(flow.insights.some((line) => /likely refund/i.test(line)));
  });
});

describe("forgetAutoPairs", () => {
  it("strips stored auto-marks so they cannot keep cancelling totals", () => {
    const debit = txn({
      id: "out",
      amount: -400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      decidedBy: "paired",
      accountId: "Up · Spending",
      categoryKey: "uncategorised",
    });
    const credit = txn({
      id: "in",
      amount: 400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      decidedBy: "paired",
      accountId: "Up · Save!!",
      categoryKey: "uncategorised",
    });
    const forgotten = forgetAutoPairs([debit, credit]);
    assert.ok(forgotten.every((row) => !row.transferPair));
    assert.ok(forgotten.every((row) => row.decidedBy !== "paired"));
    const flow = summarizeMoneyFlow(forgotten);
    assert.equal(flow.transfers, 0, "auto-marks cannot keep cancelling as confirmed transfers");
    assert.equal(flow.income, 0, "OPEN unpaired legs are held out of tiles");
    assert.equal(flow.spending, 0);
    assert.equal(flow.cashOut, 400);
  });

  it("keeps Spec 7 RESOLVE pairs that the person said", () => {
    const debit = txn({
      id: "out",
      amount: -400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      decidedBy: "said",
      accountId: "Up · Spending",
    });
    const credit = txn({
      id: "in",
      amount: 400,
      dateIso: "2026-03-12",
      type: "moved",
      transferPair: "pair-save",
      decidedBy: "said",
      accountId: "Up · Save!!",
    });
    const kept = forgetAutoPairs([debit, credit]);
    assert.equal(kept[0]?.transferPair, "pair-save");
    assert.equal(summarizeMoneyFlow(kept).actualSavings, 400);
  });
});

describe("explicit RESOLVE still writes pairs (Spec 7 will call this)", () => {
  it("markTransferLegs writes only when asked", () => {
    const rows = [
      txn({
        id: "out",
        amount: -400,
        dateIso: "2026-03-12",
        type: "spent",
        accountId: "NAB · Everyday",
        merchant: "Transfer To Savings",
        categoryKey: "uncategorised",
      }),
      txn({
        id: "in",
        amount: 400,
        dateIso: "2026-03-12",
        type: "earned",
        accountId: "NAB · Savings",
        merchant: "Transfer From Everyday",
        categoryKey: "uncategorised",
      }),
    ];
    assert.ok(rows.every((row) => !row.transferPair));
    const marked = markTransferLegs(rows);
    assert.equal(marked[0]?.transferPair, marked[1]?.transferPair);
    assert.ok(marked[0]?.transferPair);
    assert.equal(summarizeMoneyFlow(marked).transfers, 400);
    assert.equal(summarizeMoneyFlow(rows).transfers, 0);
  });

  it("markRefundLegs writes only when asked", () => {
    const paid = txn({
      id: "paid",
      amount: -80,
      dateIso: "2026-03-03",
      merchant: "Kmart Wagga",
      type: "spent",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
    });
    const back = txn({
      id: "back",
      amount: 80,
      dateIso: "2026-03-04",
      merchant: "Kmart Wagga",
      type: "earned",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
      bank: { type: "Refund" },
    });
    const marked = markRefundLegs([paid, back]);
    assert.ok(marked[0]?.refundPair);
    assert.equal(summarizeMoneyFlow(marked).refunds, 80);
    assert.equal(summarizeMoneyFlow([paid, back]).refunds, 0);
  });
});

describe("AI does not silently confirm pairs", () => {
  it("applyTagSuggestions never writes transferPair, refundPair, moved, or returned", () => {
    const rows = [
      txn({
        id: "out",
        amount: -50,
        dateIso: "2026-03-12",
        type: "spent",
        categoryKey: "uncategorised",
        decidedBy: "unreviewed",
      }),
      txn({
        id: "in",
        amount: 50,
        dateIso: "2026-03-12",
        type: "earned",
        categoryKey: "uncategorised",
        decidedBy: "unreviewed",
        bank: { type: "Refund" },
      }),
    ];
    const { transactions } = applyTagSuggestions(rows, [
      { id: "out", category: "groceries", confidence: 0.9 },
      { id: "in", category: "other-income", confidence: 0.9 },
    ]);
    assert.ok(transactions.every((row) => !row.transferPair && !row.refundPair));
    assert.ok(
      transactions.every(
        (row) => row.type !== "moved" && row.type !== "returned" && row.type !== "TRANSFER" && row.type !== "REFUND",
      ),
    );
    assert.ok(transactions.every((row) => row.decidedBy !== "paired"));
  });
});
