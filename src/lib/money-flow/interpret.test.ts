import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { accountsByInstitution, accountsFrom } from "./accounts";
import { detectFileKind } from "./detect";
import { interpretDocuments } from "./interpret";
import { parseAmount, parseDate, roundMoney } from "./parse-values";
import { sourceValue } from "./source";
import { summarizeMoneyFlow, chartTagFlowSeries, tagFlowOverTime } from "./summary";
import { filterByScope } from "./scope";
import { markTransferLegs, matchTransfers, withoutMatchedLegs } from "./transfers";
import type { InterpretedTransaction, TransactionType } from "./types";

let flowRowCount = 0;

function flowRow(
  dateIso: string,
  date: string,
  amount: number,
  categoryKey: string,
  type: TransactionType,
): InterpretedTransaction {
  flowRowCount += 1;
  return {
    id: `flow-${flowRowCount}`,
    merchant: `Merchant ${flowRowCount}`,
    categoryKey,
    date,
    dateIso,
    amount,
    type,
    sourceFile: "flow-test",
    confidence: 1,
  };
}

process.env.OPENAI_API_KEY = "";

const samples = path.join(process.cwd(), "public/samples");

function file(filename: string, mime: string, contents: string | Uint8Array) {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  return { filename, mime, bytes };
}

describe("value parsing", () => {
  it("reads Australian and signed amounts", () => {
    assert.equal(parseAmount("86.40"), 86.4);
    assert.equal(parseAmount("1,234.50"), 1234.5);
    assert.equal(parseAmount("(18.99)"), -18.99);
    assert.equal(parseAmount("2,620.00 CR"), 2620);
    assert.equal(parseAmount("42.00 DR"), -42);
    assert.equal(parseAmount("662.40 INTER-BANK CREDIT"), 662.4);
    assert.equal(parseAmount("-200.00"), -200);
  });

  it("reads common statement dates", () => {
    assert.equal(parseDate("25/08/2026"), "2026-08-25");
    assert.equal(parseDate("18 Aug 2026"), "2026-08-18");
    assert.equal(parseDate("20260815000000"), "2026-08-15");
    assert.equal(parseDate(new Date(2026, 7, 25)), "2026-08-25");
    assert.equal(parseDate(new Date(2026, 7, 1)), "2026-08-01");
    assert.equal(parseDate("31/04/2026"), null);
    assert.equal(parseDate("31/02/2026"), null);
    assert.equal(parseDate(46259), "2026-08-25");
  });
});

describe("document interpretation", () => {
  it("interprets a debit and credit column CSV into money flow", async () => {
    const csv = [
      "Date,Description,Debit,Credit,Balance",
      "25/08/2026,WOOLWORTHS 3120 BONDI,86.40,,2184.20",
      "24/08/2026,NETFLIX.COM,18.99,,2270.60",
      "18/08/2026,SALARY ACME PTY LTD,,2620.00,2289.59",
      "17/08/2026,OPAL TAP OFF,42.00,,-330.41",
      "15/08/2026,RENT PAYMENT SMITH,980.00,,-288.41",
      "14/08/2026,BUNNINGS 3090,64.50,,691.59",
      "12/08/2026,TRANSFER TO SAVINGS 082,400.00,,756.09",
      "04/08/2026,SALARY ACME PTY LTD,,2620.00,1156.09",
      "03/08/2026,COLES 0782,72.15,,-1463.91",
      "02/08/2026,CAFE SYDNEY,28.40,,-1391.76",
    ].join("\n");
    const result = await interpretDocuments([file("everyday.csv", "text/csv", csv)]);
    assert.equal(result.files[0].processingStatus, "completed");
    assert.equal(result.flow.income, 5240);
    // One account on its own cannot show where the $400 went, so it counts as spending
    // and is flagged until the account that received it is uploaded too.
    assert.equal(result.flow.transfers, 0);
    assert.equal(result.flow.unmatchedInternal, 400);
    assert.ok(result.transactions.some((txn) => /woolworths/i.test(txn.merchant)));
    assert.ok(result.transactions.some((txn) => txn.categoryKey === "home"));
    assert.equal(result.flow.net, result.flow.income - result.flow.spending);
    assert.equal(result.flow.cashIn, 5240);
    assert.equal(result.flow.cashOut, 1692.44);
    assert.equal(result.flow.cashNet, 3547.56);
  });

  it("interprets OFX credit and debit tags", async () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT
<DTPOSTED>20260825000000
<TRNAMT>-86.40
<NAME>WOOLWORTHS BONDI
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT
<DTPOSTED>20260818000000
<TRNAMT>2620.00
<NAME>SALARY ACME PTY LTD
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT
<DTPOSTED>20260815000000
<TRNAMT>-980.00
<NAME>RENT PAYMENT SMITH
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const result = await interpretDocuments([file("export.ofx", "application/x-ofx", ofx)]);
    assert.equal(result.flow.income, 2620);
    assert.equal(result.flow.spending, 1066.4);
    assert.equal(result.transactions.length, 3);
  });

  it("interprets unstructured receipt notes", async () => {
    const text = [
      "25 Aug 2026  Woolworths Bondi  $86.40 DR",
      "18 Aug 2026  Salary Acme Pty Ltd  $2,620.00 CR",
      "15 Aug 2026  Rent Payment Smith  $980.00 DR",
      "02 Aug 2026  Cafe Sydney  $28.40 DR",
    ].join("\n");
    const result = await interpretDocuments([file("notes.txt", "text/plain", text)]);
    assert.ok(result.transactions.length >= 3);
    assert.equal(result.flow.income, 2620);
  });

  it("interprets JSON transaction arrays", async () => {
    const json = JSON.stringify({
      transactions: [
        { date: "2026-08-25", description: "Woolworths", amount: -86.4 },
        { date: "2026-08-18", merchant: "Salary", amount: 2000 },
      ],
    });
    const result = await interpretDocuments([file("export.json", "application/json", json)]);
    assert.equal(result.transactions.length, 2);
    assert.equal(result.flow.income, 2000);
    assert.equal(result.flow.spending, 86.4);
  });

  it("interprets QIF bank records", async () => {
    const qif = `!Type:Bank
D25/08/2026
T-86.40
PWoolworths
^
D18/08/2026
T2620.00
PSalary Acme
^
`;
    const result = await interpretDocuments([file("export.qif", "application/qif", qif)]);
    assert.equal(result.flow.income, 2620);
    assert.equal(result.flow.spending, 86.4);
  });

  it("interprets an Excel statement", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Description", "Amount"],
      ["25/08/2026", "Woolworths Bondi", -86.4],
      ["18/08/2026", "Salary Acme Pty Ltd", 1500],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const result = await interpretDocuments([file("statement.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)]);
    assert.equal(result.files[0].kind, "xlsx");
    assert.equal(result.flow.income, 1500);
    assert.equal(result.flow.spending, 86.4);
  });

  it("keeps Excel date cells on the calendar day, including month boundaries", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Description", "Amount"],
      [new Date(2026, 7, 25), "Woolworths Bondi", -86.4],
      [new Date(2026, 7, 1), "Rent Payment Smith", -980],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const result = await interpretDocuments([
      file("dates.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes),
    ]);
    assert.equal(result.transactions.find((txn) => txn.merchant === "Woolworths Bondi")?.dateIso, "2026-08-25");
    assert.equal(result.transactions.find((txn) => txn.merchant.includes("Rent"))?.dateIso, "2026-08-01");
  });

  it("keeps two same-day purchases at the same shop, and merchants whose names include Total", async () => {
    const csv = `Date,Description,Amount
02/08/2026,Cafe Sydney,-5.50
02/08/2026,Cafe Sydney,-5.50
25/08/2026,Total Tools,-45.00
25/08/2026,Closing balance,1234.00
`;
    const result = await interpretDocuments([file("stmt.csv", "text/csv", csv)]);
    assert.equal(result.transactions.filter((txn) => txn.merchant === "Cafe Sydney").length, 2);
    assert.equal(result.transactions.some((txn) => txn.merchant === "Total Tools"), true);
    assert.equal(result.transactions.some((txn) => /closing balance/i.test(txn.merchant)), false);
    assert.equal(result.flow.spending, 56);
  });

  it("drops a movement only when a second file repeats it", async () => {
    const first = `Date,Description,Amount
25/08/2026,Woolworths,-86.40
`;
    const second = `Date,Description,Amount
25/08/2026,Woolworths,-86.40
02/08/2026,Cafe Sydney,-5.50
`;
    const result = await interpretDocuments([
      file("july.csv", "text/csv", first),
      file("august.csv", "text/csv", second),
    ]);
    assert.equal(result.transactions.filter((txn) => txn.merchant === "Woolworths").length, 1);
    assert.equal(result.transactions.some((txn) => txn.merchant === "Cafe Sydney"), true);
    assert.equal(result.flow.spending, 91.9);
  });

  it("interprets a text PDF statement", async () => {
    const pdf = minimalPdf("25/08/2026 Woolworths 86.40 DR\n18/08/2026 Salary Acme 1500.00 CR");
    const result = await interpretDocuments([file("statement.pdf", "application/pdf", pdf)]);
    assert.equal(detectFileKind("statement.pdf", "application/pdf", pdf), "pdf");
    assert.ok(result.transactions.length >= 1, JSON.stringify(result, null, 2));
  });

  it("sniffs file kinds from names and bytes", () => {
    assert.equal(detectFileKind("photo.PNG", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image");
    assert.equal(detectFileKind("notes.txt", "text/plain", new TextEncoder().encode("hello")), "text");
  });
});

describe("NAB CSV exports", () => {
  const nabFiles = ["nab-medicare.csv", "nab-rent.csv"];

  function amountsFromCsv(filename: string): number[] {
    return readFileSync(path.join(samples, filename), "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => Number(line.split(",")[1]))
      .filter((amount) => Number.isFinite(amount) && amount !== 0);
  }

  async function interpretNab() {
    return interpretDocuments(
      nabFiles.map((filename) => file(filename, "text/csv", readFileSync(path.join(samples, filename)))),
    );
  }

  it("takes every amount from the Amount column rather than a neighbouring cell", async () => {
    const result = await interpretNab();
    const expected = nabFiles.flatMap(amountsFromCsv).sort((a, b) => a - b);
    const actual = result.transactions.map((txn) => txn.amount).sort((a, b) => a - b);
    assert.deepEqual(actual, expected);
  });

  it("totals the two accounts the way the statements do", async () => {
    const result = await interpretNab();
    const moneyIn = result.transactions.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0);
    const moneyOut = result.transactions.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + txn.amount, 0);
    assert.equal(Math.round(moneyIn * 100) / 100, 204214.49);
    assert.equal(Math.round(moneyOut * 100) / 100, -203665.05);
    assert.equal(result.flow.cashIn, 204214.49);
    assert.equal(result.flow.cashOut, 203665.05);
    assert.equal(result.flow.cashNet, 549.44);
  });

  it("reads a lender's credit as borrowing, whatever the bank filed it under", async () => {
    const result = await interpretNab();
    const drawdown = result.transactions.find((txn) => /soc-/i.test(txn.merchant));
    assert.equal(drawdown?.amount, 25000);
    // NAB files this under "Transfers in". It is neither a transfer nor income: money from
    // a consumer lender changes nothing about what the household owns, and counting it as
    // earnings put $25,000 into a single month that was never earned.
    assert.equal(drawdown?.type, "borrowed");
    assert.equal(drawdown?.categoryKey, "debt");
    const outgoing = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === -200);
    assert.ok(outgoing, "the same day's outgoing transfer should stay negative");
  });

  it("keeps every NAB cell on the source row, including the ones we do not interpret", async () => {
    const result = await interpretNab();
    const drawdown = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === 25000);
    assert.equal(sourceValue(drawdown?.source, "Balance"), "4913.07");
    assert.equal(sourceValue(drawdown?.source, "Category"), "Transfers in");
    assert.equal(sourceValue(drawdown?.source, "Merchant Name"), "");
    assert.equal(sourceValue(drawdown?.source, "Processed On"), "30 Jun 26");
    assert.equal(drawdown?.type, "borrowed");
    assert.equal(drawdown?.categoryKey, "debt");

    const benefit = result.transactions.find((txn) => txn.dateIso === "2026-06-29" && txn.amount === 662.4);
    assert.equal(sourceValue(benefit?.source, "Category"), "Refund");
    assert.equal(sourceValue(benefit?.source, "Merchant Name"), "Medicare");
    assert.equal(benefit?.categoryKey, "income");
    assert.equal(benefit?.type, "earned");
  });

  it("names the merchant from the Merchant Name column", async () => {
    const result = await interpretNab();
    const medicare = result.transactions.find((txn) => txn.dateIso === "2026-06-29" && txn.amount === 662.4);
    assert.equal(medicare?.merchant, "Medicare");
    // A benefit arriving, not a payment to a doctor. The merchant is the same either way.
    assert.equal(medicare?.categoryKey, "income");
    assert.equal(medicare?.type, "earned");
    assert.ok(result.transactions.some((txn) => txn.merchant === "Woolworths (Wagga Wagga North)"));
  });

  it("treats charged interest as an expense and interest paid as income", async () => {
    const result = await interpretNab();
    const charged = result.transactions.find((txn) => /interest charged/i.test(txn.merchant));
    assert.equal(charged?.amount, -0.61);
    assert.equal(charged?.type, "spent");
    const paid = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === 0.1);
    assert.equal(paid?.type, "earned");
  });

  it("drops the zero-value interest rate notices", async () => {
    const result = await interpretNab();
    const rows = nabFiles.reduce(
      (total, filename) => total + readFileSync(path.join(samples, filename), "utf8").trim().split("\n").length - 1,
      0,
    );
    assert.equal(rows, 446);
    assert.equal(result.transactions.length, 437);
    assert.ok(!result.transactions.some((txn) => txn.merchant.includes("Interest Rate Is")));
  });

  it("reads NAB as a NAB export and uses the Category column when rules miss", async () => {
    const result = await interpretNab();
    assert.ok(result.files.every((fileResult) => fileResult.notes.some((note) => note.includes("NAB account export"))));
    const grocery = result.transactions.find((txn) => txn.merchant === "Woolworths (Wagga Wagga North)" && txn.amount === -12.8);
    assert.equal(grocery?.categoryKey, "food");
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
01 Jun 26,-15.40,100200300,,EFTPOS DEBIT,XYZ MART 999,-15.40,Groceries,,01 Jun 26
01 Jun 26,80.00,100200300,,INTER-BANK CREDIT,CENTRELINK PAYMENT,64.60,Government payments,,01 Jun 26
01 Jun 26,-50.00,100200300,,TRANSFER DEBIT,TO SAVINGS,14.60,Transfers out,,01 Jun 26
`;
    const tagged = await interpretDocuments([file("nab-gaps.csv", "text/csv", csv)]);
    assert.equal(tagged.transactions.find((txn) => txn.amount === -15.4)?.categoryKey, "food");
    assert.equal(tagged.transactions.find((txn) => txn.amount === 80)?.categoryKey, "income");
    // "Transfers out" is not a category and never was. Whether this money reached another
    // of the person's accounts is settled by finding the other leg, so until then it is
    // unsorted, counted, and flagged.
    const moved = tagged.transactions.find((txn) => txn.amount === -50);
    assert.equal(moved?.categoryKey, "uncategorised");
    assert.equal(moved?.bank?.category, "Transfers out");
    assert.equal(moved?.type, "spent", "an unmatched leg counts, and is flagged rather than believed");
  });
});

const upSample = path.join(samples, "up-2025-07-to-2026-06.txt");

describe("Up Bank statement backend", () => {
  it("interprets an Up-style statement layout, including page-broken amounts", async () => {
    const text = `July 2026 Statement
Up is a brand of Bendigo and Adelaide Bank Limited
Closing Balance $50.94
Friday, 31st Jul
1:32pm Woolworths
Wagga Wagga, NSW WOOLWORTHS 12091, WAGGA WAGGA Purchase
Zap Card **0434 $10.50 $50.94
1:21pm Osko Payment Received
JANE CITIZEN Osko Payment Received +
$300.00 $325.51
1:13am Soul Origin
Wagga Wagga, NSW GLORY ENTERPRISE P,WAGGA WAGGA Refund +$7.90 $242.99
12:47pm Transfer from Tax +$75.00 $76.26
`;
    const result = await interpretDocuments([file("up-statement.txt", "text/plain", text)]);
    assert.equal(result.files[0].processingStatus, "completed");
    assert.deepEqual(result.files[0].notes, ["Read as an Up / Bendigo bank statement."]);
    assert.equal(result.transactions.length, 4);
    assert.equal(result.transactions.find((txn) => txn.merchant === "Woolworths")?.amount, -10.5);
    assert.equal(result.transactions.find((txn) => txn.merchant === "JANE CITIZEN")?.amount, 300);
    // Read on its own, with no payment to reverse and no other account in sight, neither
    // of these is settled. Both are money that arrived, counted and flagged rather than
    // quietly removed on the strength of a word — `returned` and `moved` are written only
    // once the matcher has found the payment or the other leg.
    assert.equal(result.transactions.find((txn) => txn.merchant === "Soul Origin")?.type, "earned");
    assert.equal(result.transactions.find((txn) => txn.merchant === "Transfer from Tax")?.type, "earned");
    assert.equal(result.flow.spending, 10.5);
    // Nothing was reversed here: the payment this credit would cancel is not in the file.
    // It counts as money in and is put to the person, rather than being removed because
    // Up wrote the word "Refund" beside it.
    assert.equal(result.flow.refunds, 0);
    // The Tax saver's own leg is not in this excerpt, so the $75 is not yet a transfer.
    assert.equal(result.flow.transfers, 0);
    assert.equal(result.flow.unmatchedInternal, 75);
    assert.equal(result.flow.income, 382.9);
  });

  async function readUpSample() {
    return interpretDocuments([
      { filename: "up-2025-07-to-2026-06.txt", mime: "text/plain", bytes: new Uint8Array(readFileSync(upSample)) },
    ]);
  }

  it("reads the year sample as an Up statement", async () => {
    const result = await readUpSample();
    const fileResult = result.files[0];
    assert.equal(fileResult.processingStatus, "completed");
    assert.ok(fileResult.notes.includes("Read as an Up / Bendigo bank statement."));
    assert.ok(result.transactions.length > 1000, `txn count ${result.transactions.length}`);
    assert.ok(result.transactions.some((txn) => txn.merchant === "Zambrero"));
  });

  it("keeps the printed Up block on the source row", async () => {
    const result = await readUpSample();
    const kfc = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === -14.95 && txn.merchant === "KFC");
    assert.equal(sourceValue(kfc?.source, "Date"), "2026-06-30");
    assert.equal(sourceValue(kfc?.source, "Amount"), "$14.95");
    assert.equal(sourceValue(kfc?.source, "Balance"), "$177.64");
    assert.equal(sourceValue(kfc?.source, "Account"), "Spending");
    assert.equal(kfc?.amount, -14.95);
  });

  it("counts day headings back through the year they belong to", async () => {
    const result = await readUpSample();
    const dates = result.transactions.map((txn) => txn.dateIso).sort();
    // The statement heads itself "01 Jul 2025 to 30 Jun 2026" and its day headings carry no year.
    assert.ok(dates[0] >= "2025-07-01", `earliest ${dates[0]}`);
    assert.ok(dates[dates.length - 1] <= "2026-06-30", `latest ${dates[dates.length - 1]}`);
    assert.ok(dates.some((date) => date.startsWith("2025-")), "the first half of the year should be dated 2025");
    assert.ok(dates.some((date) => date.startsWith("2026-")), "the second half should be dated 2026");
  });

  it("reads the money coming in from the other bank", async () => {
    const result = await readUpSample();
    const osko = result.transactions.filter((txn) => /osko payment received/i.test(`${txn.description ?? ""} ${txn.bank?.type ?? ""}`));
    assert.ok(osko.length > 50, `osko receipts ${osko.length}`);
    assert.ok(osko.every((txn) => txn.amount > 0));
    const received = osko.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === 200);
    assert.equal(received?.merchant, "JORDAN LEE");
  });

  it("reconciles the year sample to the summary the statement prints", async () => {
    const result = await readUpSample();
    // The statement heads itself "Money In +$70,574.39 Money Out $71,631.34". Those count
    // money entering and leaving Up, so they exclude the movements the holder makes between
    // their own Spending account and their savers.
    //
    // Income and spending sit $448.89 under the bank's own figures, and deliberately: a
    // Bunnings charge of $418.94 and a Domino's one of $29.95 were reversed, and money
    // handed back is neither earned nor spent. The bank counts the cash both ways.
    const reversed = 418.94 + 29.95;
    assert.equal(result.flow.income, roundMoney(70574.39 - reversed));
    assert.equal(result.flow.spending, roundMoney(71631.34 - reversed));
    assert.equal(roundMoney(result.flow.income - result.flow.spending), -1056.95);
  });

  it("keeps money moved between the holder's own Up accounts out of the totals", async () => {
    const result = await readUpSample();
    const internal = result.transactions.filter((txn) => txn.type === "moved");
    const intoSavers = roundMoney(
      internal.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
    );
    const backToSpending = roundMoney(
      internal.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0),
    );
    // Every leg is written twice, once in the Spending account and once in the saver, so the
    // two sides carry the same money and cancel. Counting either side as income or spending
    // is what made the statement read high.
    assert.equal(internal.length, 84);
    assert.equal(intoSavers, 14446.6);
    assert.equal(backToSpending, 14446.6);
    assert.equal(roundMoney(backToSpending - intoSavers), 0);
  });

  it("runs the server action against the year sample", async () => {
    const { interpretUploadedDocuments } = await import("../../app/actions/interpret-documents");
    const form = new FormData();
    form.append("files", new File([readFileSync(upSample)], "up-2025-07-to-2026-06.txt", { type: "text/plain" }));
    const result = await interpretUploadedDocuments(form);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.transactions.length > 1000);
    assert.equal(result.files[0].kind, "text");
  });

  it("carries no personal detail into the shared sample", () => {
    const text = readFileSync(upSample, "utf8");
    assert.match(text, /Jordan Lee/, "the sample should use the same pseudonym as the NAB samples");
    for (const pattern of [/steven/i, /taehyun/i, /nellie/i, /mitchell park/i]) {
      assert.doesNotMatch(text, pattern);
    }
    // Account and reference numbers are kept in shape but blanked after the first digit.
    const unmasked = (text.match(/\b\d{7,}\b/g) ?? []).filter((digits) => digits.replace(/0/g, "").length > 1);
    assert.deepEqual(unmasked, []);
  });
});

describe("money flow summary", () => {
  it("counts a savings transfer until the account it landed in is here too", () => {
    const rows: InterpretedTransaction[] = [
      {
        id: "1",
        merchant: "Salary",
        categoryKey: "income",
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2000,
        type: "earned",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Transfer To Savings",
        categoryKey: "uncategorised",
        date: "12 Aug",
        dateIso: "2026-08-12",
        amount: -400,
        type: "moved",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Woolworths",
        categoryKey: "food",
        date: "25 Aug",
        dateIso: "2026-08-25",
        amount: -80,
        type: "spent",
        sourceFile: "demo",
        confidence: 1,
      },
    ];
    const summary = summarizeMoneyFlow(rows);
    // Nothing here shows the $400 arriving anywhere, so it counts and is flagged.
    assert.equal(summary.income, 2000);
    assert.equal(summary.spending, 480);
    assert.equal(summary.transfers, 0);
    assert.equal(summary.unmatchedInternal, 400);
    assert.equal(summary.net, 1520);
    assert.equal(summary.cashIn, 2000);
    assert.equal(summary.cashOut, 480);
    assert.equal(summary.cashNet, 1520);
    assert.deepEqual(
      summary.categories.map((category) => category.name),
      // Keyed, not named. The $400 has no category — nothing has said where it went — and
      // "not sorted yet" is a different thing from a bucket somebody chose.
      ["uncategorised", "food"],
    );

    // Upload the savings account and the same $400 stops being spending, because both
    // ends of the movement can now be seen.
    const settled = summarizeMoneyFlow(
      markTransferLegs([
        ...rows,
        {
          id: "4",
          merchant: "Transfer From Everyday",
          categoryKey: "uncategorised",
          date: "12 Aug",
          dateIso: "2026-08-12",
          amount: 400,
          type: "moved",
          sourceFile: "savings.csv",
          accountId: "NAB · Savings",
          confidence: 1,
        },
      ]),
    );

    assert.equal(settled.spending, 80);
    assert.equal(settled.transfers, 400);
    assert.equal(settled.unmatchedInternal, 0);
    assert.equal(settled.income, 2000);
  });

  it("counts spending on the primary tag only, so sub-tags do not double-count", () => {
    const summary = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Cafe Sydney",
        categoryKey: "food",
        tags: ["Dining", "Coffee"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "spent",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Woolworths Bondi",
        categoryKey: "food",
        tags: ["Groceries"],
        date: "25 Aug",
        dateIso: "2026-08-25",
        amount: -86.4,
        type: "spent",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    assert.equal(summary.spending, 114.8);
    assert.deepEqual(
      summary.categories.map((category) => [category.name, category.amount]),
      // Both sit under Food & Drink now, which is the point of a two-level taxonomy: the
      // headline groups, and the detail one click in.
      [["food", 114.8]],
    );
  });

  it("splits a selected primary into sub-tags without changing the total", () => {
    const rows = [
      {
        id: "1",
        merchant: "Cafe Sydney",
        categoryKey: "food",
        tags: ["Dining", "Coffee"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "spent" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Dinner Out",
        categoryKey: "food",
        tags: ["Dining"],
        date: "21 Aug",
        dateIso: "2026-08-21",
        amount: -60,
        type: "spent" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Salary Acme",
        categoryKey: "income",
        tags: ["Salary"],
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2620,
        type: "earned" as const,
        sourceFile: "demo",
        confidence: 1,
      },
    ];
    const drilled = chartTagFlowSeries(rows, "food");
    assert.equal(drilled.level, "sub");
    assert.equal(drilled.spending, 88.4);
    assert.deepEqual(
      drilled.rows.map((row) => [row.name, row.amount]),
      // One level down from Food & Drink is now the tags on those movements, so the bar
      // is the tag they share. Read from the first tag on each, so the breakdown always
      // adds up to the category above it however many tags a movement carries.
      [["Dining", -88.4]],
    );
  });

  it("charts money in above the line and money out below it", () => {
    const rows = [
      {
        id: "1",
        merchant: "Cafe Sydney",
        categoryKey: "food",
        tags: ["Dining"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "spent" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Salary Acme",
        categoryKey: "income",
        tags: ["Income"],
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2620,
        type: "earned" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Refunded jacket",
        categoryKey: "shopping",
        tags: ["Shopping"],
        date: "19 Aug",
        dateIso: "2026-08-19",
        amount: 40,
        type: "returned" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "4",
        merchant: "Jacket",
        categoryKey: "shopping",
        tags: ["Shopping"],
        date: "17 Aug",
        dateIso: "2026-08-17",
        amount: -100,
        type: "spent" as const,
        sourceFile: "demo",
        confidence: 1,
      },
    ];
    const combined = chartTagFlowSeries(rows, "All");
    assert.equal(combined.income, 2660);
    assert.equal(combined.spending, 128.4);
    assert.equal(combined.net, 2531.6);
    assert.deepEqual(
      combined.rows.map((row) => [row.name, row.amount]),
      [
        ["income", 2620],
        ["shopping", -60],
        ["food", -28.4],
      ],
    );
  });

  it("tracks a three month run of money in and out", () => {
    // July: in 4200 + 180 refund = 4380, out 1450 + 260.75 + 700 = 2410.75, net 1969.25
    // August: in 4200, out 1450 + 612.40 + 87.60 = 2150, net 2050
    // September: in 900, out 1450 + 330.20 = 1780.20, net -880.20
    const rows = [
      flowRow("2026-07-03", "3 Jul", 4200, "income.salary", "earned"),
      flowRow("2026-07-11", "11 Jul", -1450, "home", "spent"),
      flowRow("2026-07-19", "19 Jul", -260.75, "food.groceries", "spent"),
      flowRow("2026-07-27", "27 Jul", 180, "shopping", "earned"),
      flowRow("2026-07-30", "30 Jul", -700, "uncategorised", "spent"),
      flowRow("2026-08-03", "3 Aug", 4200, "income.salary", "earned"),
      flowRow("2026-08-11", "11 Aug", -1450, "home", "spent"),
      flowRow("2026-08-16", "16 Aug", -612.4, "shopping", "spent"),
      flowRow("2026-08-23", "23 Aug", -87.6, "food.restaurants", "spent"),
      flowRow("2026-09-03", "3 Sep", 900, "income.salary", "earned"),
      flowRow("2026-09-11", "11 Sep", -1450, "home", "spent"),
      flowRow("2026-09-24", "24 Sep", -330.2, "food.groceries", "spent"),
    ];

    const points = tagFlowOverTime(rows);

    // A point per day across 3 Jul to 24 Sep, so every movement gets its own step.
    assert.equal(points.length, 84);
    assert.equal(points[0].label, "3 July");
    assert.equal(points[points.length - 1].label, "24 Sept");

    const byLabel = new Map(points.map((point) => [point.label, point]));
    assert.equal(byLabel.get("3 July")?.net, 4200);
    assert.equal(byLabel.get("11 July")?.net, -1450);
    assert.equal(byLabel.get("27 July")?.net, 180);
    assert.equal(byLabel.get("30 July")?.net, -700, "a transfer with no partner still counts");
    assert.equal(byLabel.get("16 Aug")?.net, -612.4);
    assert.equal(byLabel.get("24 Sept")?.net, -330.2);

    // Rolled back up, each month still reports the totals worked out above.
    const monthly = new Map<string, number>();
    for (const point of points) {
      const month = point.key.slice(0, 7);
      monthly.set(month, roundMoney((monthly.get(month) ?? 0) + point.net));
    }
    assert.deepEqual(
      [...monthly.entries()],
      [
        ["2026-07", 1969.25],
        ["2026-08", 2050],
        ["2026-09", -880.2],
      ],
    );

    // Everything reconciles with the summary the cards show.
    const summary = summarizeMoneyFlow(rows);
    assert.equal(roundMoney(points.reduce((sum, point) => sum + point.income, 0)), summary.income);
    assert.equal(roundMoney(points.reduce((sum, point) => sum + point.spending, 0)), summary.spending);
    assert.equal(roundMoney(points.reduce((sum, point) => sum + point.net, 0)), summary.net);
    assert.equal(points[points.length - 1].runningNet, summary.net);
  });

  it("holds the running total level through quiet days instead of dropping to zero", () => {
    const rows = [
      flowRow("2026-08-18", "18 Aug", 2620, "income.salary", "earned"),
      flowRow("2026-08-24", "24 Aug", -18.99, "leisure.streaming", "spent"),
    ];

    assert.deepEqual(
      tagFlowOverTime(rows).map((point) => [point.label, point.net, point.runningNet]),
      [
        ["18 Aug", 2620, 2620],
        ["19 Aug", 0, 2620],
        ["20 Aug", 0, 2620],
        ["21 Aug", 0, 2620],
        ["22 Aug", 0, 2620],
        ["23 Aug", 0, 2620],
        ["24 Aug", -18.99, 2601.01],
      ],
    );
  });

  it("collapses to months once the range is too long to plot daily, keeping quiet months", () => {
    const rows = [
      flowRow("2026-07-05", "5 Jul", 500, "income.salary", "earned"),
      flowRow("2027-10-05", "5 Oct", -300, "home", "spent"),
    ];

    const points = tagFlowOverTime(rows);
    assert.equal(points.length, 16, "Jul 2026 through Oct 2027 inclusive");
    assert.deepEqual([points[0].label, points[0].net, points[0].runningNet], ["Jul 2026", 500, 500]);
    assert.deepEqual([points[15].label, points[15].net, points[15].runningNet], ["Oct 2027", -300, 200]);
    assert.ok(
      points.slice(1, 15).every((point) => point.net === 0 && point.runningNet === 500),
      "the quiet months stay on the axis and hold the running total",
    );
  });

  it("keeps a quiet day on the timeline instead of closing the gap", () => {
    const rows = [
      flowRow("2026-07-05", "5 Jul", 500, "income.salary", "earned"),
      flowRow("2026-07-08", "8 Jul", -300, "home", "spent"),
    ];

    assert.deepEqual(
      tagFlowOverTime(rows).map((point) => [point.label, point.net, point.runningNet]),
      [
        ["5 July", 500, 500],
        ["6 July", 0, 500],
        ["7 July", 0, 500],
        ["8 July", -300, 200],
      ],
    );
  });

  it("fills the quiet days between movements inside a single month", () => {
    const rows = [
      flowRow("2026-08-18", "18 Aug", 2500, "income.salary", "earned"),
      flowRow("2026-08-20", "20 Aug", -900, "home", "spent"),
    ];

    assert.deepEqual(
      tagFlowOverTime(rows).map((point) => [point.key, point.label, point.net]),
      [
        ["2026-08-18", "18 Aug", 2500],
        ["2026-08-19", "19 Aug", 0],
        ["2026-08-20", "20 Aug", -900],
      ],
    );

    assert.deepEqual(
      tagFlowOverTime(rows, "home").map((point) => [point.key, point.net]),
      [["2026-08-20", -900]],
    );
  });

  it("nets a bucket below zero when spending outruns income", () => {
    const rows = [
      flowRow("2026-08-02", "2 Aug", 40, "shopping", "earned"),
      flowRow("2026-08-02", "2 Aug", -900, "home", "spent"),
    ];
    assert.deepEqual(
      tagFlowOverTime(rows).map((point) => [point.income, point.spending, point.net]),
      [[40, 900, -860]],
    );
  });

  it("leaves the category alone when a tag is renamed, because tags never move a total", () => {
    const before = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Rent Payment Smith",
        categoryKey: "home",
        tags: ["Housing"],
        date: "1 Aug",
        dateIso: "2026-08-01",
        amount: -980,
        type: "spent",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    const after = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Rent Payment Smith",
        categoryKey: "home",
        tags: ["Rent"],
        date: "1 Aug",
        dateIso: "2026-08-01",
        amount: -980,
        type: "spent",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    assert.deepEqual(
      before.categories.map((category) => category.name),
      ["home"],
    );
    // The tag changed and the figure did not move. Under the old model the first tag was
    // the category, so renaming one silently re-filed a year of spending.
    assert.deepEqual(
      after.categories.map((category) => [category.name, category.amount]),
      [["home", 980]],
    );
  });
});

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, " ")}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.1\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += `${object}\n`;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(body);
}

describe("grouping the samples by institution", () => {
  const nabFiles = ["nab-medicare.csv", "nab-rent.csv"];

  async function interpretEverySample() {
    return interpretDocuments([
      ...nabFiles.map((filename) => file(filename, "text/csv", readFileSync(path.join(samples, filename)))),
      file("up-2025-07-to-2026-06.txt", "text/plain", readFileSync(upSample)),
    ]);
  }

  it("names the bank on every movement it reads", async () => {
    const result = await interpretEverySample();
    const nab = result.transactions.filter((txn) => nabFiles.includes(txn.sourceFile));
    const up = result.transactions.filter((txn) => txn.sourceFile.startsWith("up-"));

    assert.ok(nab.every((txn) => txn.institution === "NAB"), "every NAB movement names NAB");
    assert.ok(up.every((txn) => txn.institution === "Up"), "every Up movement names Up");
  });

  it("reads the two NAB statements as one bank, on the statements' own numbers", async () => {
    const result = await interpretEverySample();
    const nab = accountsByInstitution(result.transactions).find((group) => group.institution === "NAB");

    assert.equal(nab?.flow.transactionCount, 437);
    assert.equal(nab?.flow.cashIn, 204214.49);
    assert.equal(nab?.flow.cashOut, 203665.05);
    assert.equal(nab?.flow.cashNet, 549.44);
    // Two statements, two accounts, one bank.
    assert.equal(nab?.accounts.length, 2);
  });

  it("keeps Up's own money in and out once its movements are grouped", async () => {
    const result = await interpretEverySample();
    const up = accountsByInstitution(result.transactions).find((group) => group.institution === "Up");

    assert.equal(up?.flow.transactionCount, 1267);
    // The statement's own $70,574.39 and $71,631.34, less the $448.89 of charges Bunnings
    // and Domino's reversed, which neither earned nor cost the holder anything.
    assert.equal(up?.flow.income, 70125.5);
    assert.equal(up?.flow.spending, 71182.45);
  });

  it("loses no movement and no dollar to the grouping", async () => {
    const result = await interpretEverySample();
    const groups = accountsByInstitution(result.transactions);
    const whole = summarizeMoneyFlow(result.transactions);

    // Busiest bank first: Up's 1267 movements against NAB's 437.
    assert.deepEqual(groups.map((group) => group.institution), ["Up", "NAB"]);
    assert.equal(
      groups.reduce((sum, group) => sum + group.flow.transactionCount, 0),
      result.transactions.length,
    );
    assert.equal(
      roundMoney(groups.reduce((sum, group) => sum + group.flow.cashNet, 0)),
      whole.cashNet,
    );
  });
});

describe("splitting the samples into accounts", () => {
  const nabFiles = ["nab-medicare.csv", "nab-rent.csv"];

  async function interpretEverySample() {
    return interpretDocuments([
      ...nabFiles.map((filename) => file(filename, "text/csv", readFileSync(path.join(samples, filename)))),
      file("up-2025-07-to-2026-06.txt", "text/plain", readFileSync(upSample)),
    ]);
  }

  it("reads the Up statement as its spending account and its eight savers", async () => {
    const result = await interpretEverySample();
    const up = accountsFrom(result.transactions).filter((account) => account.institution === "Up");

    assert.deepEqual(
      up.map((account) => account.label).sort(),
      [
        "Up · Bday",
        "Up · Food and gifts",
        "Up · No Touchy",
        "Up · Presents",
        "Up · Save!!",
        "Up · Savings 2",
        "Up · Spending",
        "Up · Tax",
        "Up · Tech",
      ],
    );
    assert.equal(
      up.reduce((sum, account) => sum + account.transactions.length, 0),
      1267,
    );
  });

  it("draws the savers down by what the statement says they fell", async () => {
    const result = await interpretEverySample();
    const savers = accountsFrom(result.transactions).filter(
      (account) => account.institution === "Up" && account.label !== "Up · Spending",
    );

    assert.equal(roundMoney(savers.reduce((sum, account) => sum + account.flow.cashNet, 0)), -836.34);
  });

  it("lands the spending account on the closing balance the statement prints", async () => {
    const result = await interpretEverySample();
    const spending = accountsFrom(result.transactions).find((account) => account.label === "Up · Spending");

    assert.equal(roundMoney(398.25 + (spending?.flow.cashNet ?? 0)), 177.64);
  });

  it("names both NAB accounts without reciting their numbers", async () => {
    const result = await interpretEverySample();
    const nab = accountsFrom(result.transactions).filter((account) => account.institution === "NAB");

    assert.deepEqual(nab.map((account) => account.label).sort(), ["NAB · ···300", "NAB · ···600"]);
    assert.equal(nab.find((account) => account.label === "NAB · ···300")?.flow.cashNet, 3669.02);
    assert.equal(nab.find((account) => account.label === "NAB · ···600")?.flow.cashNet, -3119.58);
  });

  it("adds every account up to the money the household actually moved", async () => {
    const result = await interpretEverySample();
    const accounts = accountsFrom(result.transactions);
    const whole = summarizeMoneyFlow(result.transactions);

    assert.equal(accounts.length, 11);
    assert.equal(roundMoney(accounts.reduce((sum, account) => sum + account.flow.cashNet, 0)), whole.cashNet);
    assert.equal(whole.cashNet, -507.51);
  });
});

describe("matching the samples' transfers", () => {
  const nabFiles = ["nab-medicare.csv", "nab-rent.csv"];

  async function interpretEverySample() {
    return interpretDocuments([
      ...nabFiles.map((filename) => file(filename, "text/csv", readFileSync(path.join(samples, filename)))),
      file("up-2025-07-to-2026-06.txt", "text/plain", readFileSync(upSample)),
    ]);
  }

  function routeTotals(pairs: ReturnType<typeof matchTransfers>["pairs"], from: string, to: string) {
    const matching = pairs.filter(
      (pair) =>
        (pair.fromAccount.startsWith(from) && pair.toAccount.startsWith(to)) ||
        (pair.fromAccount.startsWith(to) && pair.toAccount.startsWith(from)),
    );
    return {
      count: matching.length,
      value: roundMoney(matching.reduce((sum, pair) => sum + Math.abs(pair.debit.amount), 0)),
    };
  }

  it("finds the transfers between the two NAB accounts", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);

    assert.deepEqual(routeTotals(match.pairs, "NAB", "NAB"), { count: 27, value: 41842.82 });
  });

  it("finds the transfers between NAB and Up, in both directions", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);
    const toUp = match.pairs.filter((pair) => pair.fromAccount.startsWith("NAB") && pair.toAccount.startsWith("Up"));
    const toNab = match.pairs.filter((pair) => pair.fromAccount.startsWith("Up") && pair.toAccount.startsWith("NAB"));

    assert.deepEqual(routeTotals(match.pairs, "NAB", "Up"), { count: 100, value: 61894.45 });
    assert.equal(toUp.length, 97);
    assert.equal(toNab.length, 3, "money runs both ways, and a one-directional pass cannot see it");
  });

  it("finds the transfers between Up's spending account and its savers", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);
    const inside = match.pairs.filter(
      (pair) => pair.fromAccount.startsWith("Up") && pair.toAccount.startsWith("Up"),
    );

    assert.equal(inside.length, 42);
    assert.equal(roundMoney(inside.reduce((sum, pair) => sum + Math.abs(pair.debit.amount), 0)), 14446.6);
  });

  it("leaves nothing it had to guess at", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);

    assert.equal(match.pairs.length, 169);
    assert.equal(match.contested.length, 0);
    assert.equal(match.matched.size, 338);
  });

  it("matches legs that cancel each other out", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);

    assert.equal(
      roundMoney(match.pairs.reduce((sum, pair) => sum + pair.debit.amount + pair.credit.amount, 0)),
      0,
    );
  });

  it("leaves true income and true spending that agree with the money that moved", async () => {
    const result = await interpretEverySample();
    const match = matchTransfers(result.transactions);
    const counted = withoutMatchedLegs(result.transactions, match);

    const income = roundMoney(counted.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0));
    const spending = roundMoney(
      counted.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
    );

    assert.equal(income, 171051.61);
    assert.equal(spending, 171559.12);
    assert.equal(roundMoney(income - spending), summarizeMoneyFlow(result.transactions).cashNet);
    assert.equal(roundMoney(income - spending), -507.51);
  });

  it("re-decides every pair when another statement arrives, without losing the totals", async () => {
    const result = await interpretEverySample();
    const nabOnly = result.transactions.filter((txn) => txn.institution === "NAB");

    const alone = matchTransfers(nabOnly);
    const together = matchTransfers(result.transactions);

    assert.equal(alone.pairs.length, 27);
    assert.deepEqual(routeTotals(together.pairs, "NAB", "NAB"), { count: 27, value: 41842.82 });
    assert.ok(
      alone.pairs.every((pair) => together.matched.has(pair.debit.id)),
      "a debit matched from one statement stays matched once the next arrives",
    );
  });
});

describe("recognising one account across two statement formats", () => {
  it("joins a CSV export and a printed statement of the same account", async () => {
    // The CSV names the account in a column; the statement prints it on the letterhead.
    const printed = `National Australia Bank
Jordan Lee
BSB 083-004
Account Number: 100200300
Statement period 1 Jul 2026 to 31 Jul 2026

05 Jul 2026  Woolworths Wagga  $54.20 DR
08 Jul 2026  Salary Acme Pty Ltd  $2,620.00 CR
`;

    const result = await interpretDocuments([
      file("nab-medicare.csv", "text/csv", readFileSync(path.join(samples, "nab-medicare.csv"))),
      file("nab-statement.txt", "text/plain", printed),
    ]);
    const nab = accountsFrom(result.transactions).filter((account) => account.institution === "NAB");

    assert.equal(nab.length, 1, "one account, not one per file");
    assert.equal(nab[0].id, "NAB · 100200300");
    assert.deepEqual(
      [...new Set(nab[0].transactions.map((txn) => txn.sourceFile))].sort(),
      ["nab-medicare.csv", "nab-statement.txt"],
    );
  });

  it("keeps two statements that name no account apart", async () => {
    const may = "05 May 2026  Woolworths Bondi  $54.20 DR";
    const june = "05 Jun 2026  Woolworths Bondi  $54.20 DR";

    const result = await interpretDocuments([
      file("statement-may.txt", "text/plain", may),
      file("statement-june.txt", "text/plain", june),
    ]);

    assert.equal(accountsFrom(result.transactions).length, 2);
  });

  it("does not mistake the same purchase in two named accounts for one movement", async () => {
    // Same day, same amount, same shop, but each statement names a different account,
    // so these are two payments rather than one statement downloaded twice.
    const statement = (account: string) =>
      `National Australia Bank\nAccount Number: ${account}\n\n05 May 2026  Woolworths Bondi  $54.20 DR`;

    const result = await interpretDocuments([
      file("nab-everyday.txt", "text/plain", statement("100200300")),
      file("nab-rent.txt", "text/plain", statement("400500600")),
    ]);

    assert.equal(result.transactions.length, 2);
    assert.equal(result.flow.cashOut, 108.4);
  });
});

describe("what each scope reports", () => {
  const nabFiles = ["nab-medicare.csv", "nab-rent.csv"];

  async function ledger() {
    const result = await interpretDocuments([
      ...nabFiles.map((filename) => file(filename, "text/csv", readFileSync(path.join(samples, filename)))),
      file("up-2025-07-to-2026-06.txt", "text/plain", readFileSync(upSample)),
    ]);
    return markTransferLegs(result.transactions);
  }

  it("reports the household's own figures across everything", async () => {
    const flow = summarizeMoneyFlow(await ledger());

    // $3,255.59 of reversed charges are on neither side: an optical charge NAB reversed
    // the next day, and two Up purchases refunded. Cash still counts them both ways, so
    // cash net is untouched — which is what says nothing was lost rather than moved.
    //
    // Income is $25,000 below the cash that arrived, and that gap is the whole point of
    // the type layer: a SocietyOne drawdown landed in the everyday account on 30 June and
    // $24,800 left for a company the same day. Counting the credit as earnings put a
    // year's income into one month. It is borrowed money, so it is money in the account
    // and not money the household earned.
    assert.equal(flow.income, 142796.02);
    assert.equal(flow.spending, 168303.53);
    assert.equal(flow.net, -25507.51);
    assert.equal(flow.cashNet, -507.51);
  });

  it("reports each bank's own figures, which tie to its statements", async () => {
    const rows = await ledger();
    const nab = summarizeMoneyFlow(filterByScope(rows, { kind: "institution", institution: "NAB" }));
    const up = summarizeMoneyFlow(filterByScope(rows, { kind: "institution", institution: "Up" }));

    // Each bank's figures fall by the reversals inside it: NAB's $2,806.70 optical charge,
    // Up's $448.89. Neither bank's cash position moves. NAB is a further $25,000 down,
    // because the drawdown landed there and borrowed money is not earnings.
    assert.equal(nab.income, 134564.97);
    assert.equal(nab.spending, 159015.53);
    assert.equal(nab.cashNet, 549.44);
    assert.equal(up.income, 70125.5);
    assert.equal(up.spending, 71182.45);
    assert.equal(up.cashNet, -1056.95);
  });

  it("reports one account on the numbers its own statement prints", async () => {
    const rows = await ledger();
    const everyday = summarizeMoneyFlow(
      filterByScope(rows, { kind: "account", accountId: "NAB · 100200300" }),
    );

    // The statement's own money-in figure is $164,344.90 and the account's cash still ties
    // to it exactly. Income is $25,000 lower because $25,000 of what arrived was borrowed.
    assert.equal(everyday.income, 139344.9);
    assert.equal(everyday.spending, 160675.88);
    assert.equal(everyday.cashNet, 3669.02);
  });

  it("adds more money in one bank than the household, and that is correct", async () => {
    const rows = await ledger();
    const household = summarizeMoneyFlow(rows);
    const nab = summarizeMoneyFlow(filterByScope(rows, { kind: "institution", institution: "NAB" }));
    const up = summarizeMoneyFlow(filterByScope(rows, { kind: "institution", institution: "Up" }));

    // Money NAB sent to Up left NAB, so both banks count it; only a view holding both
    // can see it never left the household.
    assert.ok(nab.income + up.income > household.income);
    assert.equal(
      roundMoney(nab.income + up.income - household.income),
      roundMoney(nab.spending + up.spending - household.spending),
    );
  });
});
