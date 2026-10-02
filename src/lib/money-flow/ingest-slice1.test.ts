import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { accountsByInstitution } from "./accounts";
import { interpretDocuments } from "./interpret";
import { appendToLedger, EMPTY_LEDGER } from "./ledger";
import { parseAmount } from "./parse-values";
import { filterByPeriod } from "./period";
import { parseDocument } from "./parsers";
import { sourceFromPairs } from "./source";
import {
  accountBalanceView,
  fileIndexOf,
  mostRecentStatedBalances,
  NO_BANK_BALANCE_LABEL,
  statedBalanceFromSource,
} from "./statement-balance";
import { summarizeMoneyFlow } from "./summary";
import { countsAsIncome, countsAsSpending } from "./taxonomy";
import type { InterpretedTransaction } from "./types";
import { looksLikeUpStatement } from "./up-statement";

const samples = path.join(process.cwd(), "src/lib/money-flow/fixtures/retired-samples");

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "uncategorised",
    date: over.dateIso,
    type: "SPENDING",
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

describe("F1 osko is not an Up detector", () => {
  const westpac = `Westpac Choice
osko payment received
Opening Balance $1,000.00
12 Mar 2026 Osko payment received $50.00 $1,050.00
14 Mar 2026 Cafe Darling $20.00 $1,030.00
16 Mar 2026 Grocer $30.00 $1,000.00
Closing Balance $1,000.00`;

  it("reads a non-Up statement that says osko payment received", async () => {
    assert.equal(looksLikeUpStatement(westpac), false);
    assert.equal(looksLikeUpStatement("up is a brand of bendigo and adelaide bank"), true);
    assert.equal(looksLikeUpStatement("Zap card **4821"), true);
    const result = await interpretDocuments([
      { filename: "westpac.txt", mime: "text/plain", bytes: Buffer.from(westpac) },
    ]);
    assert.ok(result.transactions.length >= 3, `expected movements, got ${result.transactions.length}`);
  });
});

describe("F3 zero amounts", () => {
  it("keeps a parsed zero", () => {
    assert.equal(parseAmount("0.00"), 0);
    assert.equal(parseAmount(0), 0);
    assert.equal(parseAmount("$0.00"), 0);
  });

  it("drops a notice and keeps a real zero-dollar movement", async () => {
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
01 Jun 26,0.00,100200300,,MISCELLANEOUS DEBIT,The interest rate is 5 percent,10.00,Fees,,01 Jun 26
02 Jun 26,0.00,100200300,,EFTPOS DEBIT,Zero dollar eftpos,10.00,Groceries,Cafe,02 Jun 26
03 Jun 26,-4.00,100200300,,EFTPOS DEBIT,Cafe,6.00,Eating out,Cafe,03 Jun 26`;
    const result = await interpretDocuments([
      { filename: "nab-zero.csv", mime: "text/csv", bytes: Buffer.from(csv) },
    ]);
    assert.equal(result.transactions.some((row) => /interest rate/i.test(row.description ?? "")), false);
    const zero = result.transactions.find((row) => row.amount === 0);
    assert.ok(zero);
    assert.match(zero.description ?? "", /Zero dollar eftpos/);
    assert.equal(result.transactions.some((row) => row.amount === -4), true);
  });

  it("stores a $0.00 OFX LEDGERBAL once, not on every row", async () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>633123<ACCTID>999000111</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT
<DTPOSTED>20260601
<TRNAMT>-1.00
<NAME>Cafe
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>0.00
<DTASOF>20260601000000
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const parsed = await parseDocument("zero.ofx", "application/x-ofx", new TextEncoder().encode(ofx));
    assert.equal(parsed.statedBalance, 0);
    assert.equal(parsed.balanceSource, "ofx_ledger");
    assert.ok(parsed.transactions.every((row) => statedBalanceFromSource(row) == null));
    const stored = appendToLedger(
      EMPTY_LEDGER,
      {
        files: [
          {
            filename: "zero.ofx",
            fileType: "other",
            kind: "ofx",
            uploadStatus: "uploaded",
            processingStatus: "completed",
            transactionCount: parsed.transactions.length,
            notes: parsed.notes,
            statedBalance: parsed.statedBalance,
            balanceSource: parsed.balanceSource,
            balanceAsOf: parsed.balanceAsOf,
          },
        ],
        transactions: parsed.transactions,
      },
      { importedAt: "2026-06-01T00:00:00.000Z" },
    );
    const meta = Object.values(stored.ledger.accountMeta ?? {})[0];
    assert.equal(meta?.clearedBalance, 0);
    assert.equal(meta?.balanceSource, "ofx_ledger");
  });
});

describe("F4 file index and Up closing", () => {
  it("reads the index after -up- and -ofx- and keeps the lowest index on the latest date", () => {
    assert.equal(
      fileIndexOf(txn({ id: "up.txt-up-0-2026-06-30--12", dateIso: "2026-06-30", amount: -12, sourceFile: "up.txt" })),
      0,
    );
    assert.equal(fileIndexOf(txn({ id: "up.txt-ofx-2", dateIso: "2026-06-30", amount: 1, sourceFile: "up.txt" })), 2);
    const rows = [
      txn({
        id: "up.txt-up-3-2026-06-30--5.59",
        dateIso: "2026-06-30",
        amount: -1,
        accountId: "Up · Spending",
        sourceFile: "up.txt",
        source: sourceFromPairs([
          ["Description", "PayPal"],
          ["Balance", "5.59"],
        ]),
      }),
      txn({
        id: "up.txt-up-0-2026-06-30--12",
        dateIso: "2026-06-30",
        amount: -1,
        accountId: "Up · Spending",
        sourceFile: "up.txt",
        source: sourceFromPairs([
          ["Description", "KFC"],
          ["Balance", "177.64"],
        ]),
      }),
    ];
    assert.equal(mostRecentStatedBalances(rows)["Up · Spending"], 177.64);
  });

  it("stores Up printed closings and the sample total", async () => {
    const up = await interpretDocuments([
      {
        filename: "up-2025-07-to-2026-06.txt",
        mime: "text/plain",
        bytes: readFileSync(path.join(samples, "up-2025-07-to-2026-06.txt")),
      },
    ]);
    const nab = await interpretDocuments([
      {
        filename: "nab-medicare.csv",
        mime: "text/csv",
        bytes: readFileSync(path.join(samples, "nab-medicare.csv")),
      },
      {
        filename: "nab-rent.csv",
        mime: "text/csv",
        bytes: readFileSync(path.join(samples, "nab-rent.csv")),
      },
    ]);
    const { ledger } = appendToLedger(EMPTY_LEDGER, up, { importedAt: "2026-07-01T00:00:00.000Z" });
    const withNab = appendToLedger(ledger, nab, { importedAt: "2026-07-02T00:00:00.000Z" }).ledger;
    const meta = withNab.accountMeta ?? {};
    const closing = (id: string) => meta[id]?.clearedBalance;
    assert.equal(closing("Up · Spending"), 177.64);
    assert.equal(meta["Up · Spending"]?.balanceSource, "header");
    assert.equal(meta["Up · Spending"]?.openingBalance, 398.25);
    assert.equal(closing("Up · Save!!"), 0.87);
    assert.equal(closing("Up · Tax"), 75.55);
    assert.equal(closing("Up · Savings 2"), 0.57);
    assert.equal(closing("Up · Presents"), 0.98);
    assert.equal(closing("Up · Bday"), 0.71);
    assert.equal(closing("Up · No Touchy"), 0.79);
    assert.equal(closing("Up · Tech"), 0.44);
    assert.equal(closing("Up · Food and gifts"), 0);
    assert.equal(closing("NAB · 100200300"), 4913.07);
    assert.equal(closing("NAB · 400500600"), 0.49);
    const total = Object.values(meta).reduce((sum, row) => sum + (row.clearedBalance ?? 0), 0);
    assert.equal(Math.round(total * 100) / 100, 5171.11);

    const spending = up.transactions.filter((row) => row.accountId === "Up · Spending");
    const flow = summarizeMoneyFlow(spending);
    assert.equal(flow.cashIn, 70564.53);
    assert.equal(flow.cashOut, 71631.34);
    assert.equal(flow.income, 0);
  });
});

describe("F5 bank balance", () => {
  it("does not turn an opening plus movements into a balance", () => {
    const rows = [
      txn({
        id: "in",
        dateIso: "2026-06-01",
        amount: 2000,
        type: "TRANSFER",
        accountId: "Up · Investing",
      }),
      txn({
        id: "out",
        dateIso: "2026-06-02",
        amount: -1433.14,
        type: "INVESTMENT",
        accountId: "Up · Investing",
      }),
    ];
    const openingOnly = accountBalanceView("Up · Investing", rows, {
      "Up · Investing": { openingBalance: 100 },
    });
    assert.equal(openingOnly.amount, null);
    assert.equal(openingOnly.label, NO_BANK_BALANCE_LABEL);
    assert.notEqual(openingOnly.amount, 666.86);

    const pdf = accountBalanceView("Up · Investing", rows, {
      "Up · Investing": { clearedBalance: 666.86, balanceSource: "header" },
    });
    assert.equal(pdf.amount, null);
    assert.equal(pdf.label, NO_BANK_BALANCE_LABEL);

    const fiskil = accountBalanceView("Up · Investing", rows, {
      "Up · Investing": { clearedBalance: 0, balanceSource: "fiskil" },
    });
    assert.equal(fiskil.amount, 0);
    assert.equal(fiskil.label, undefined);
  });

  it("hides the figure when the bank sent none and shows a CSV or running cell, including zero", () => {
    const rows = [txn({ id: "a", dateIso: "2026-06-01", amount: 500, type: "INCOME", accountId: "NAB · Everyday" })];
    const missing = accountBalanceView("NAB · Everyday", rows, {});
    assert.equal(missing.amount, null);
    assert.equal(missing.label, NO_BANK_BALANCE_LABEL);
    assert.equal("prompt" in missing, false);

    const header = accountBalanceView("NAB · Everyday", rows, {
      "NAB · Everyday": { clearedBalance: 177.64, balanceSource: "header", openingBalance: 10 },
    });
    assert.equal(header.amount, null);
    assert.equal(header.label, NO_BANK_BALANCE_LABEL);

    const running = accountBalanceView("NAB · Everyday", rows, {
      "NAB · Everyday": { clearedBalance: 0, balanceSource: "running" },
    });
    assert.equal(running.amount, 0);
    assert.equal(running.source, "running");
    assert.equal(running.label, undefined);
  });
});

describe("F6 later OFX snapshot wins", () => {
  function ofx(filename: string, asOf: string | null, amount: string, posted: string): string {
    const dated = asOf ? `<DTASOF>${asOf}\n` : "";
    return `OFXHEADER:100
<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>up</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>633123<ACCTID>123456789</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT
<DTPOSTED>${posted}
<TRNAMT>10.00
<NAME>Pay ${filename}
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${amount}
${dated}</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  }

  async function read(filename: string, body: string) {
    const parsed = await parseDocument(filename, "application/x-ofx", new TextEncoder().encode(body));
    return {
      files: [
        {
          filename,
          fileType: "other" as const,
          kind: "ofx" as const,
          uploadStatus: "uploaded" as const,
          processingStatus: "completed" as const,
          transactionCount: parsed.transactions.length,
          notes: parsed.notes,
          ...(parsed.statedBalance != null ? { statedBalance: parsed.statedBalance } : {}),
          ...(parsed.balanceSource ? { balanceSource: parsed.balanceSource } : {}),
          ...(parsed.balanceAsOf ? { balanceAsOf: parsed.balanceAsOf } : {}),
        },
      ],
      transactions: parsed.transactions,
    };
  }

  it("keeps the later DTASOF even when the other file has the later transaction", async () => {
    const laterTxn = await read("early-snapshot.ofx", ofx("early-snapshot.ofx", "20260601000000", "100.00", "20260610"));
    const laterSnap = await read("later-snapshot.ofx", ofx("later-snapshot.ofx", "20260620000000", "250.00", "20260602"));
    const undated = await read("undated.ofx", ofx("undated.ofx", null, "1.00", "20260603"));
    assert.ok(laterTxn.transactions.length > 0);
    assert.equal(laterTxn.files[0]?.statedBalance, 100);
    assert.equal(laterSnap.files[0]?.balanceAsOf, "2026-06-20");

    let ledger = appendToLedger(EMPTY_LEDGER, laterTxn, { importedAt: "2026-06-11T00:00:00.000Z" }).ledger;
    ledger = appendToLedger(ledger, laterSnap, { importedAt: "2026-06-21T00:00:00.000Z" }).ledger;
    const id = "Up · 123456789";
    assert.equal(ledger.accountMeta?.[id]?.clearedBalance, 250);
    assert.equal(ledger.accountMeta?.[id]?.balanceAsOf, "2026-06-20");

    ledger = appendToLedger(ledger, undated, { importedAt: "2026-06-22T00:00:00.000Z" }).ledger;
    assert.equal(ledger.accountMeta?.[id]?.clearedBalance, 250);

    let reversed = appendToLedger(EMPTY_LEDGER, laterSnap, { importedAt: "2026-06-21T00:00:00.000Z" }).ledger;
    reversed = appendToLedger(reversed, laterTxn, { importedAt: "2026-06-22T00:00:00.000Z" }).ledger;
    assert.equal(reversed.accountMeta?.[id]?.clearedBalance, 250);
  });
});

describe("F7 one-legged TRANSFER", () => {
  it("is never Income or Spending, including across a month", () => {
    assert.equal(countsAsIncome("TRANSFER"), false);
    assert.equal(countsAsSpending("TRANSFER"), false);

    const pair = "pair-1";
    const rows = [
      txn({
        id: "out",
        dateIso: "2026-05-31",
        amount: -400,
        type: "TRANSFER",
        transferPair: pair,
        accountId: "Up · Spending",
      }),
      txn({
        id: "in",
        dateIso: "2026-06-01",
        amount: 400,
        type: "TRANSFER",
        transferPair: pair,
        accountId: "Up · Save!!",
      }),
      txn({
        id: "cafe",
        dateIso: "2026-06-02",
        amount: -20,
        type: "SPENDING",
        accountId: "Up · Spending",
      }),
    ];
    const june = filterByPeriod(rows, { kind: "month", month: "2026-06" });
    const juneSpend = june.filter((row) => row.accountId === "Up · Spending");
    const juneSave = june.filter((row) => row.accountId === "Up · Save!!");
    assert.equal(summarizeMoneyFlow(juneSpend).spending, 20);
    assert.equal(summarizeMoneyFlow(juneSpend).income, 0);
    assert.equal(summarizeMoneyFlow(juneSpend).cashOut, 20);
    assert.equal(summarizeMoneyFlow(juneSave).income, 0);
    assert.equal(summarizeMoneyFlow(juneSave).cashIn, 0);
    assert.equal(summarizeMoneyFlow(june).income, 0);

    const spendingOnly = rows.filter((row) => row.accountId === "Up · Spending");
    assert.equal(summarizeMoneyFlow(spendingOnly).spending, 20);
    assert.equal(summarizeMoneyFlow(spendingOnly).income, 0);
    assert.equal(summarizeMoneyFlow(spendingOnly).cashOut, 20);

    const lone = summarizeMoneyFlow([
      txn({ id: "lone", dateIso: "2026-06-01", amount: 400, type: "TRANSFER", accountId: "Up · Spending" }),
    ]);
    assert.equal(lone.income, 0);
    assert.equal(lone.cashIn, 0);

    const groups = accountsByInstitution(rows);
    const spending = groups.flatMap((group) => group.accounts).find((account) => account.id === "Up · Spending");
    assert.equal(spending?.flow.income, 0);
    assert.equal(spending?.flow.spending, 20);
  });
});
