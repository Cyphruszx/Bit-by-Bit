import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountBalanceOf } from "./dashboard";
import { detectInstitution } from "./institution";
import { interpretDocuments } from "./interpret";
import { parseDocument } from "./parsers";
import { summarizeMoneyFlow } from "./summary";
import { derivedMovementBalance } from "./statement-balance";
import {
  classifyKnownInternalTransfers,
  isBankTransferType,
  isInternalTransfer,
  isUpOfxPocketTransfer,
} from "./internal-transfers";
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

function upOfx(body: string, ledger = "340.40"): string {
  return `OFXHEADER:100
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>up
</FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>633123<ACCTID>123456789</BANKACCTFROM>
<BANKTRANLIST>
${body}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${ledger}
<DTASOF>20260605000000
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

function stmttrn(type: string, posted: string, amount: string, name: string): string {
  return `<STMTTRN><TRNTYPE>${type}
<DTPOSTED>${posted}
<TRNAMT>${amount}
<NAME>${name}
<FITID>${posted}${amount}${name}
</STMTTRN>`;
}

describe("Up CSV Transfer type cash tiles", () => {
  it("omits Transfer credits/debits from in/out and from fallback balance", () => {
    const rows = classifyKnownInternalTransfers([
      txn({ id: "pay", amount: 2000, type: "earned", categoryKey: "salary", bank: { type: "Salary" } }),
      txn({ id: "loan", amount: 250, type: "borrowed", categoryKey: "uncategorised", bank: { type: "Payment" } }),
      txn({ id: "cafe", amount: -40, type: "spent", bank: { type: "Purchase" } }),
      txn({
        id: "to-saver",
        amount: -500,
        type: "spent",
        accountId: "Up · Spending",
        transferPair: "spend~cash",
        bank: { type: "Transfer" },
      }),
      txn({
        id: "from-spend",
        amount: 500,
        type: "earned",
        accountId: "Up · CashFlow",
        transferPair: "spend~cash",
        bank: { type: "Transfer" },
      }),
      txn({ id: "netflix", amount: -20, type: "spent", bank: { type: "Direct Debit" } }),
      txn({ id: "betashare", amount: -15, type: "spent", bank: { type: "Payment" } }),
    ]);

    assert.equal(rows.filter(isBankTransferType).length, 2);
    assert.equal(rows.filter(isInternalTransfer).length, 2);
    assert.equal(rows.find((row) => row.id === "to-saver")?.type, "TRANSFER");
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 2250, "Salary + Payment — Transfer credit omitted");
    assert.equal(flow.cashOut, 75, "Purchase + Direct Debit + Payment — Transfer debit omitted");
    assert.equal(flow.cashNet, 2175);
    assert.equal(flow.income, 2000, "Dashboard Income is unchanged");
    assert.equal(flow.spending, 75, "Dashboard Spending is unchanged");
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
    assert.equal(result.transactions.filter((row) => isBankTransferType(row)).length, 2);
    assert.ok(
      result.transactions.filter(isBankTransferType).every((row) => row.type === "TRANSFER"),
      "Up CSV Transfer is classified TRANSFER at ingest",
    );

    const flow = summarizeMoneyFlow(result.transactions);
    assert.equal(flow.cashIn, 2000, "Salary only — Transfer credit omitted");
    assert.equal(flow.cashOut, 75, "Purchase + Direct Debit + Payment — Transfer debit omitted");
    assert.equal(derivedMovementBalance(result.transactions), flow.cashIn - flow.cashOut);
    assert.equal(accountBalanceOf(result.transactions), flow.cashNet);
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

    assert.equal(isBankTransferType(rows[0]!), false);
    assert.equal(isBankTransferType(rows[1]!), false);
    assert.equal(isBankTransferType(rows[2]!), false);
    assert.equal(isBankTransferType(rows[3]!), true);

    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.cashIn, 15409.86);
    assert.equal(flow.cashOut, 75, "blank and missing types stay in; Transfer is omitted");
    assert.equal(derivedMovementBalance(rows), 15409.86 - 75);
  });

  it("does not treat NAB TRANSFER DEBIT as classified until pairing writes TRANSFER", async () => {
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
12 Aug 26,-400.00,100200300,,TRANSFER DEBIT,To Savings,100.00,Internal transfers,To Savings,12 Aug 26
12 Aug 26,400.00,100200300,,TRANSFER CREDIT,From Everyday,500.00,Internal transfers,From Everyday,12 Aug 26
12 Aug 26,-40.00,100200300,,EFTPOS DEBIT,Cafe,60.00,Eating out,Cafe,12 Aug 26`;

    const result = await interpretDocuments([
      { filename: "nab-everyday.csv", mime: "text/csv", bytes: Buffer.from(csv) },
    ]);

    assert.ok(result.transactions.every((row) => row.institution === "NAB"));
    assert.equal(result.transactions.filter((row) => isBankTransferType(row)).length, 0);
    const unpaired = result.transactions.filter((row) => !row.transferPair);
    assert.ok(unpaired.every((row) => row.type !== "TRANSFER"));
    const flow = summarizeMoneyFlow(result.transactions);
    assert.equal(flow.cashIn, 400, "unclassified NAB TRANSFER CREDIT still ties to the statement");
    assert.equal(flow.cashOut, 440);
  });
});

describe("classified internals on every bank", () => {
  it("omits TRANSFER kind and paired legs from Money in/out", () => {
    const rows = [
      txn({
        id: "pay",
        amount: 3000,
        type: "earned",
        categoryKey: "salary",
        institution: "NAB",
        accountId: "NAB · Everyday",
      }),
      txn({
        id: "loan",
        amount: 25000,
        type: "borrowed",
        categoryKey: "uncategorised",
        institution: "NAB",
        accountId: "NAB · Everyday",
        merchant: "Lender",
      }),
      txn({
        id: "shop",
        amount: -40,
        type: "spent",
        institution: "NAB",
        accountId: "NAB · Everyday",
      }),
      txn({
        id: "move-out",
        amount: -400,
        type: "moved",
        transferPair: "pair",
        institution: "NAB",
        accountId: "NAB · Everyday",
      }),
      txn({
        id: "move-in",
        amount: 400,
        type: "moved",
        transferPair: "pair",
        institution: "NAB",
        accountId: "NAB · Savings",
      }),
    ];
    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.income, 3000);
    assert.equal(flow.spending, 40);
    assert.equal(flow.net, 2960);
    assert.equal(flow.cashIn, 28000, "salary + loan — paired transfer omitted");
    assert.equal(flow.cashOut, 40, "shop only — paired transfer omitted");
  });
});

describe("Up OFX pocket DEBIT/CREDIT", () => {
  it("classifies saver names as TRANSFER and prefers LEDGERBAL for balance", async () => {
    const ofx = upOfx(
      [
        stmttrn("CREDIT", "20260601000000", "2000.00", "SALARY ACME PTY LTD"),
        stmttrn("DEBIT", "20260602000000", "-40.00", "Cafe"),
        stmttrn("DEBIT", "20260603000000", "-500.00", "CashFlow"),
        stmttrn("CREDIT", "20260603000000", "220.00", "Essentials"),
        stmttrn("DEBIT", "20260603010000", "-80.00", "Investing"),
        stmttrn("DEBIT", "20260603020000", "-90.00", "Emergency Fund"),
        stmttrn("DEBIT", "20260603030000", "-30.00", "Presents"),
        stmttrn("CREDIT", "20260603040000", "15.00", "Tax"),
        stmttrn("DEBIT", "20260604000000", "-20.00", "Netflix"),
        stmttrn("DEBIT", "20260605000000", "-15.00", "BetaShare"),
      ].join("\n"),
      "340.40",
    );

    const parsed = await parseDocument("up-export.ofx", "application/x-ofx", new TextEncoder().encode(ofx));
    assert.equal(parsed.statedBalance, 340.4);
    assert.ok(parsed.transactions.every((row) => row.institution === "Up"));

    const pockets = parsed.transactions.filter(isUpOfxPocketTransfer);
    assert.equal(pockets.length, 6);
    assert.ok(pockets.every((row) => row.type === "TRANSFER"));
    assert.ok(pockets.every((row) => /^(debit|credit)$/i.test(row.bank?.type ?? "")));

    const beta = parsed.transactions.find((row) => /betashare/i.test(row.merchant));
    assert.ok(beta);
    assert.equal(isInternalTransfer(beta!), false);
    assert.notEqual(beta!.type, "TRANSFER");

    const flow = summarizeMoneyFlow(parsed.transactions);
    assert.equal(flow.cashIn, 2000, "Salary only — pocket credits omitted");
    assert.equal(flow.cashOut, 75, "Cafe + Netflix + BetaShare — pocket debits omitted");
    assert.equal(accountBalanceOf(parsed.transactions), 340.4, "LEDGERBAL BALAMT preferred");
    assert.notEqual(accountBalanceOf(parsed.transactions), flow.cashNet);
    assert.notEqual(accountBalanceOf(parsed.transactions), flow.net);
  });

  it("matches Up CSV Transfer exclude on the same movements", async () => {
    const csv = upCsv(
      [
        "01/06/2026,09:00,2026-06-01 00:00:00,2000.00,2000.00,Spending,Income,Income,,Salary,Pay,,01/06/2026",
        "02/06/2026,10:00,2026-06-02 00:00:00,-40.00,-40.00,Spending,Eating Out,Lifestyle,,Purchase,Cafe,,02/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,-500.00,-500.00,Spending,,,CashFlow,Transfer,CashFlow,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,220.00,220.00,Spending,,,,Transfer,Essentials,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,-80.00,-80.00,Spending,,,,Transfer,Investing,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,-90.00,-90.00,Spending,,,,Transfer,Emergency Fund,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,-30.00,-30.00,Spending,,,,Transfer,Presents,,03/06/2026",
        "03/06/2026,11:00,2026-06-03 00:00:00,15.00,15.00,Spending,,,,Transfer,Tax,,03/06/2026",
        "04/06/2026,12:00,2026-06-04 00:00:00,-20.00,-20.00,Spending,Bills,Bills,,Direct Debit,Netflix,,04/06/2026",
        "05/06/2026,13:00,2026-06-05 00:00:00,-15.00,-15.00,Spending,Investments,Investments,,Payment,BetaShare,,05/06/2026",
      ].join("\n"),
    );
    const ofx = upOfx(
      [
        stmttrn("CREDIT", "20260601000000", "2000.00", "SALARY ACME PTY LTD"),
        stmttrn("DEBIT", "20260602000000", "-40.00", "Cafe"),
        stmttrn("DEBIT", "20260603000000", "-500.00", "CashFlow"),
        stmttrn("CREDIT", "20260603000000", "220.00", "Essentials"),
        stmttrn("DEBIT", "20260603010000", "-80.00", "Investing"),
        stmttrn("DEBIT", "20260603020000", "-90.00", "Emergency Fund"),
        stmttrn("DEBIT", "20260603030000", "-30.00", "Presents"),
        stmttrn("CREDIT", "20260603040000", "15.00", "Tax"),
        stmttrn("DEBIT", "20260604000000", "-20.00", "Netflix"),
        stmttrn("DEBIT", "20260605000000", "-15.00", "BetaShare"),
      ].join("\n"),
    );

    const csvResult = await interpretDocuments([
      { filename: "transactions.csv", mime: "text/csv", bytes: Buffer.from(csv) },
    ]);
    const ofxParsed = await parseDocument("up-export.ofx", "application/x-ofx", new TextEncoder().encode(ofx));

    const csvFlow = summarizeMoneyFlow(csvResult.transactions);
    const ofxFlow = summarizeMoneyFlow(ofxParsed.transactions);
    assert.equal(csvFlow.cashIn, ofxFlow.cashIn);
    assert.equal(csvFlow.cashOut, ofxFlow.cashOut);
    assert.equal(csvFlow.cashIn, 2000);
    assert.equal(csvFlow.cashOut, 75);
  });
});
