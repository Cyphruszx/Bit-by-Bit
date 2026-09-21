import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountBalanceOf } from "./dashboard";
import { detectInstitution } from "./institution";
import { interpretDocuments } from "./interpret";
import { summarizeMoneyFlow } from "./summary";
import { derivedMovementBalance } from "./statement-balance";
import { isUpTransferType } from "./up-cash";
import type { InterpretedTransaction } from "./types";

const UP_CSV_HEADERS =
  "Date,Time,UTC Date Time,Amount (AUD),Total (AUD),Account,Category,Parent Category,Tags,Transaction Type,Description,Message,Settled Date";

function upCsv(rows: string): string {
  return `${UP_CSV_HEADERS}\n${rows}`;
}

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount">,
): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: "1 Jun 2026",
    dateIso: "2026-06-01",
    type: over.type ?? (over.amount > 0 ? "earned" : "spent"),
    sourceFile: "up-export.csv",
    confidence: 1,
    institution: "Up",
    ...over,
  };
}

describe("Up Transfer type cash tiles", () => {
  it("omits Transfer credits/debits from in/out and from fallback balance", () => {
    const rows = [
      txn({ id: "pay", amount: 2000, type: "earned", categoryKey: "salary", bank: { type: "Salary" } }),
      txn({ id: "loan", amount: 250, type: "borrowed", categoryKey: "uncategorised", bank: { type: "Payment" } }),
      txn({ id: "cafe", amount: -40, type: "spent", bank: { type: "Purchase" } }),
      txn({
        id: "to-saver",
        amount: -500,
        type: "TRANSFER",
        accountId: "Up · Spending",
        bank: { type: "Transfer" },
      }),
      txn({
        id: "from-spend",
        amount: 500,
        type: "TRANSFER",
        accountId: "Up · CashFlow",
        bank: { type: "Transfer" },
      }),
      txn({ id: "netflix", amount: -20, type: "spent", bank: { type: "Direct Debit" } }),
      txn({ id: "betashare", amount: -15, type: "spent", bank: { type: "Payment" } }),
    ];

    assert.equal(rows.filter(isUpTransferType).length, 2);
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 2250, "Salary + Payment — Transfer credit omitted");
    assert.equal(flow.cashOut, 75, "Purchase + Direct Debit + Payment — Transfer debit omitted");
    assert.equal(flow.cashNet, 2175);
    assert.equal(derivedMovementBalance(rows), 2175);
    assert.equal(accountBalanceOf(rows), 2175);
    assert.equal(accountBalanceOf(rows), flow.cashIn - flow.cashOut);
    assert.notEqual(accountBalanceOf(rows), flow.net);
  });

  it("omits Transaction Type Transfer from an Up-shaped CSV ingest", async () => {
    const csv = upCsv(
      [
        "01/06/2026,09:00,2026-06-01 00:00:00,2000.00,2000.00,Spending,Income,Income,,Salary,Pay,,01/06/2026",
        "02/06/2026,10:00,2026-06-02 00:00:00,-40.00,-40.00,Spending,Eating Out,Lifestyle,,Purchase,Cafe,,02/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,-500.00,-500.00,Spending,,,CashFlow,Transfer,To CashFlow,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,500.00,500.00,CashFlow,,,,Transfer,From Spending,,03/06/2026",
        "04/06/2026,12:00,2026-06-04 00:00:00,-20.00,-20.00,Spending,Bills,Bills,,Direct Debit,Netflix,,04/06/2026",
        "05/06/2026,13:00,2026-06-05 00:00:00,-15.00,-15.00,Spending,Investments,Investments,,Payment,BetaShare,,05/06/2026",
      ].join("\n"),
    );

    const result = await interpretDocuments([
      { filename: "transactions.csv", mime: "text/csv", bytes: Buffer.from(csv) },
    ]);

    assert.equal(detectInstitution({ headers: UP_CSV_HEADERS.split(","), filename: "transactions.csv" }), "Up");
    assert.ok(result.transactions.every((row) => row.institution === "Up"));
    assert.equal(result.transactions.filter((row) => isUpTransferType(row)).length, 2);

    const flow = summarizeMoneyFlow(result.transactions);
    assert.equal(flow.cashIn, 2000, "Salary only — Transfer credit omitted");
    assert.equal(flow.cashOut, 75, "Purchase + Direct Debit + Payment — Transfer debit omitted");
    assert.equal(derivedMovementBalance(result.transactions), flow.cashIn - flow.cashOut);
    assert.equal(accountBalanceOf(result.transactions), flow.cashNet);
  });

  it("leaves NAB TRANSFER DEBIT/CREDIT in Money in and Money out", async () => {
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
12 Aug 26,-400.00,100200300,,TRANSFER DEBIT,To Savings,100.00,Internal transfers,To Savings,12 Aug 26
12 Aug 26,400.00,100200300,,TRANSFER CREDIT,From Everyday,500.00,Internal transfers,From Everyday,12 Aug 26
12 Aug 26,-40.00,100200300,,EFTPOS DEBIT,Cafe,60.00,Eating out,Cafe,12 Aug 26`;

    const result = await interpretDocuments([
      { filename: "nab-everyday.csv", mime: "text/csv", bytes: Buffer.from(csv) },
    ]);

    assert.ok(result.transactions.every((row) => row.institution === "NAB"));
    assert.equal(result.transactions.filter((row) => isUpTransferType(row)).length, 0);
    const flow = summarizeMoneyFlow(result.transactions);
    assert.equal(flow.cashIn, 400);
    assert.equal(flow.cashOut, 440);
  });

  it("includes blank or missing Up Transaction Type in Money in/out", () => {
    const rows = [
      txn({ id: "pay", amount: 15409.86, type: "earned", categoryKey: "salary" }),
      txn({
        id: "blank-type",
        amount: -50,
        type: "spent",
        bank: { type: "   " },
        source: { headers: ["Transaction Type"], values: [""] },
      }),
      txn({
        id: "no-type",
        amount: -25,
        type: "spent",
        source: { headers: ["Amount"], values: ["-25.00"] },
      }),
      txn({
        id: "to-saver",
        amount: -500,
        type: "TRANSFER",
        bank: { type: "Transfer" },
      }),
    ];

    assert.equal(isUpTransferType(rows[0]!), false);
    assert.equal(isUpTransferType(rows[1]!), false);
    assert.equal(isUpTransferType(rows[2]!), false);
    assert.equal(isUpTransferType(rows[3]!), true);

    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 15409.86);
    assert.equal(flow.cashOut, 75, "blank and missing types stay in; Transfer is omitted");
    assert.equal(derivedMovementBalance(rows), 15409.86 - 75);
  });

  it("does not apply Transfer exclusion to non-Up banks", () => {
    const rows = [
      txn({
        id: "nab-out",
        amount: -400,
        institution: "NAB",
        accountId: "NAB · 100200300",
        bank: { type: "Transfer" },
      }),
      txn({
        id: "nab-in",
        amount: 400,
        institution: "NAB",
        accountId: "NAB · 100200300",
        bank: { type: "Transfer" },
      }),
      txn({
        id: "cafe",
        amount: -40,
        institution: "NAB",
        accountId: "NAB · 100200300",
        bank: { type: "EFTPOS DEBIT" },
      }),
    ];

    assert.equal(rows.filter(isUpTransferType).length, 0);
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 400);
    assert.equal(flow.cashOut, 440);
  });
});
