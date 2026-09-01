import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { detectFileKind } from "./detect";
import { interpretDocuments } from "./interpret";
import { parseAmount, parseDate } from "./parse-values";
import { summarizeMoneyFlow, chartTagFlowSeries, tagFlowOverTime } from "./summary";

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
  });
});

describe("document interpretation", () => {
  it("interprets a Commonwealth Bank CSV into money flow", async () => {
    const csv = readFileSync(path.join(samples, "commonwealth-bank.csv"));
    const result = await interpretDocuments([file("commonwealth-bank.csv", "text/csv", csv)]);
    assert.equal(result.files[0].processingStatus, "completed");
    assert.equal(result.flow.income, 5240);
    assert.equal(result.flow.transfers, 400);
    assert.ok(result.transactions.some((txn) => txn.merchant.includes("Woolworths")));
    assert.ok(result.transactions.some((txn) => txn.category === "Housing"));
    assert.equal(result.flow.net, result.flow.income - result.flow.spending);
    assert.equal(result.flow.cashIn, 5240);
    assert.equal(result.flow.cashOut, 1692.44);
    assert.equal(result.flow.cashNet, 3547.56);
  });

  it("interprets OFX credit and debit tags", async () => {
    const ofx = readFileSync(path.join(samples, "activity.ofx"));
    const result = await interpretDocuments([file("activity.ofx", "application/x-ofx", ofx)]);
    assert.equal(result.flow.income, 2620);
    assert.equal(result.flow.spending, 1066.4);
    assert.equal(result.transactions.length, 3);
  });

  it("interprets unstructured receipt notes", async () => {
    const text = readFileSync(path.join(samples, "receipt-notes.txt"));
    const result = await interpretDocuments([file("receipt-notes.txt", "text/plain", text)]);
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

  it("keeps incoming transfers positive", async () => {
    const result = await interpretNab();
    const drawdown = result.transactions.find((txn) => txn.merchant.startsWith("Soc-"));
    assert.equal(drawdown?.amount, 25000);
    assert.equal(drawdown?.type, "transfer");
    const outgoing = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === -200);
    assert.ok(outgoing, "the same day's outgoing transfer should stay negative");
  });

  it("names the merchant from the Merchant Name column", async () => {
    const result = await interpretNab();
    const medicare = result.transactions.find((txn) => txn.dateIso === "2026-06-29" && txn.amount === 662.4);
    assert.equal(medicare?.merchant, "Medicare");
    assert.equal(medicare?.category, "Health");
    assert.ok(result.transactions.some((txn) => txn.merchant === "Woolworths (Wagga Wagga North)"));
  });

  it("treats charged interest as an expense and interest paid as income", async () => {
    const result = await interpretNab();
    const charged = result.transactions.find((txn) => txn.merchant === "Interest Charged");
    assert.equal(charged?.amount, -0.61);
    assert.equal(charged?.type, "expense");
    const paid = result.transactions.find((txn) => txn.dateIso === "2026-06-30" && txn.amount === 0.1);
    assert.equal(paid?.type, "income");
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
    assert.equal(grocery?.category, "Groceries");
    const csv = `Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On
01 Jun 26,-15.40,100200300,,EFTPOS DEBIT,XYZ MART 999,-15.40,Groceries,,01 Jun 26
01 Jun 26,80.00,100200300,,INTER-BANK CREDIT,CENTRELINK PAYMENT,64.60,Government payments,,01 Jun 26
01 Jun 26,-50.00,100200300,,TRANSFER DEBIT,TO SAVINGS,14.60,Transfers out,,01 Jun 26
`;
    const tagged = await interpretDocuments([file("nab-gaps.csv", "text/csv", csv)]);
    assert.equal(tagged.transactions.find((txn) => txn.amount === -15.4)?.category, "Groceries");
    assert.equal(tagged.transactions.find((txn) => txn.amount === 80)?.category, "Income");
    assert.equal(tagged.transactions.find((txn) => txn.amount === -50)?.category, "Goals");
    assert.equal(tagged.transactions.find((txn) => txn.amount === -50)?.type, "transfer");
  });
});

const uploadedUpPdf = "/home/ubuntu/.cursor/projects/workspace/uploads/statement-2026-07_a358.pdf";

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
    assert.equal(result.transactions.find((txn) => txn.merchant === "Osko Payment Received")?.amount, 300);
    assert.equal(result.transactions.find((txn) => txn.merchant === "Soul Origin")?.type, "refund");
    assert.equal(result.transactions.find((txn) => txn.merchant === "Transfer From Tax")?.type, "transfer");
    assert.equal(result.flow.spending, 10.5);
    assert.equal(result.flow.refunds, 7.9);
    assert.equal(result.flow.transfers, 75);
    assert.equal(result.flow.income, 307.9);
  });

  it("interprets the uploaded July 2026 Up PDF through interpretDocuments", { skip: !existsSync(uploadedUpPdf) }, async () => {
    const bytes = new Uint8Array(readFileSync(uploadedUpPdf));
    const result = await interpretDocuments([{ filename: "statement-2026-07.pdf", mime: "application/pdf", bytes }]);
    const fileResult = result.files[0];
    assert.equal(fileResult.processingStatus, "completed");
    assert.equal(fileResult.kind, "pdf");
    assert.ok(fileResult.notes.includes("Read as an Up / Bendigo bank statement."));
    assert.equal(result.flow.spending, 5619.59);
    assert.ok(Math.abs(result.flow.income - 5418.24) < 0.05, `income ${result.flow.income}`);
    assert.ok(result.transactions.length >= 120, `txn count ${result.transactions.length}`);
    assert.match(result.flow.periodLabel, /1 Jul.*31 Jul/);
    assert.ok(
      result.transactions.some((txn) => txn.merchant === "Woolworths" && txn.amount === -10.5 && txn.dateIso === "2026-07-31"),
    );
    assert.ok(result.transactions.some((txn) => txn.merchant === "Osko Payment Received" && txn.amount === 1000));
    assert.ok(result.transactions.some((txn) => txn.merchant === "Zambrero"));
    assert.ok(result.transactions.some((txn) => txn.merchant === "Soul Origin" && txn.type === "refund"));
  });

  it("runs the server action against the uploaded Up PDF", { skip: !existsSync(uploadedUpPdf) }, async () => {
    const { interpretUploadedDocuments } = await import("../../app/actions/interpret-documents");
    const bytes = readFileSync(uploadedUpPdf);
    const form = new FormData();
    form.append("files", new File([bytes], "statement-2026-07.pdf", { type: "application/pdf" }));
    const result = await interpretUploadedDocuments(form);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.flow.spending, 5619.59);
    assert.ok(Math.abs(result.flow.income - 5418.24) < 0.05, `income ${result.flow.income}`);
    assert.ok(result.transactions.length >= 120);
    assert.equal(result.files[0].kind, "pdf");
  });
});

describe("money flow summary", () => {
  it("treats savings transfers as set-aside money, not spending", () => {
    const summary = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Salary",
        category: "Income",
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2000,
        type: "income",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Transfer To Savings",
        category: "Goals",
        date: "12 Aug",
        dateIso: "2026-08-12",
        amount: -400,
        type: "transfer",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Woolworths",
        category: "Groceries",
        date: "25 Aug",
        dateIso: "2026-08-25",
        amount: -80,
        type: "expense",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    assert.equal(summary.income, 2000);
    assert.equal(summary.spending, 80);
    assert.equal(summary.transfers, 400);
    assert.equal(summary.net, 1920);
    assert.equal(summary.cashIn, 2000);
    assert.equal(summary.cashOut, 480);
    assert.equal(summary.cashNet, 1520);
    assert.deepEqual(
      summary.categories.map((category) => category.name),
      ["Groceries"],
    );
  });

  it("counts spending on the primary tag only, so sub-tags do not double-count", () => {
    const summary = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Cafe Sydney",
        category: "Dining",
        tags: ["Dining", "Coffee"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "expense",
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Woolworths Bondi",
        category: "Groceries",
        tags: ["Groceries"],
        date: "25 Aug",
        dateIso: "2026-08-25",
        amount: -86.4,
        type: "expense",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    assert.equal(summary.spending, 114.8);
    assert.deepEqual(
      summary.categories.map((category) => [category.name, category.amount]),
      [
        ["Groceries", 86.4],
        ["Dining", 28.4],
      ],
    );
  });

  it("splits a selected primary into sub-tags without changing the total", () => {
    const rows = [
      {
        id: "1",
        merchant: "Cafe Sydney",
        category: "Dining",
        tags: ["Dining", "Coffee"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "expense" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Dinner Out",
        category: "Dining",
        tags: ["Dining"],
        date: "21 Aug",
        dateIso: "2026-08-21",
        amount: -60,
        type: "expense" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Salary Acme",
        category: "Income",
        tags: ["Income", "Salary"],
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2620,
        type: "income" as const,
        sourceFile: "demo",
        confidence: 1,
      },
    ];
    const drilled = chartTagFlowSeries(rows, "Dining");
    assert.equal(drilled.level, "sub");
    assert.equal(drilled.spending, 88.4);
    assert.deepEqual(
      drilled.rows.map((row) => [row.name, row.amount]),
      [
        ["No sub-tag", -60],
        ["Coffee", -28.4],
      ],
    );
  });

  it("charts money in above the line and money out below it", () => {
    const rows = [
      {
        id: "1",
        merchant: "Cafe Sydney",
        category: "Dining",
        tags: ["Dining"],
        date: "20 Aug",
        dateIso: "2026-08-20",
        amount: -28.4,
        type: "expense" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Salary Acme",
        category: "Income",
        tags: ["Income"],
        date: "18 Aug",
        dateIso: "2026-08-18",
        amount: 2620,
        type: "income" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "3",
        merchant: "Refunded jacket",
        category: "Shopping",
        tags: ["Shopping"],
        date: "19 Aug",
        dateIso: "2026-08-19",
        amount: 40,
        type: "refund" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "4",
        merchant: "Jacket",
        category: "Shopping",
        tags: ["Shopping"],
        date: "17 Aug",
        dateIso: "2026-08-17",
        amount: -100,
        type: "expense" as const,
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
        ["Income", 2620],
        ["Shopping", -60],
        ["Dining", -28.4],
      ],
    );
  });

  it("tracks money in and out by month, and by day within a single month", () => {
    const july = {
      id: "1",
      merchant: "Salary Acme",
      category: "Income",
      tags: ["Income"],
      date: "18 Jul",
      dateIso: "2026-07-18",
      amount: 2000,
      type: "income" as const,
      sourceFile: "demo",
      confidence: 1,
    };
    const augustIn = {
      id: "2",
      merchant: "Salary Acme",
      category: "Income",
      tags: ["Income"],
      date: "18 Aug",
      dateIso: "2026-08-18",
      amount: 2500,
      type: "income" as const,
      sourceFile: "demo",
      confidence: 1,
    };
    const augustOut = {
      id: "3",
      merchant: "Rent",
      category: "Housing",
      tags: ["Housing"],
      date: "20 Aug",
      dateIso: "2026-08-20",
      amount: -900,
      type: "expense" as const,
      sourceFile: "demo",
      confidence: 1,
    };

    assert.deepEqual(
      tagFlowOverTime([augustOut, july, augustIn]).map((point) => [point.key, point.income, point.spending, point.net]),
      [
        ["2026-07", 2000, 0, 2000],
        ["2026-08", 2500, 900, 1600],
      ],
    );

    const singleMonth = tagFlowOverTime([augustOut, augustIn]);
    assert.deepEqual(
      singleMonth.map((point) => [point.key, point.label, point.net]),
      [
        ["2026-08-18", "18 Aug", 2500],
        ["2026-08-20", "20 Aug", -900],
      ],
    );

    assert.deepEqual(
      tagFlowOverTime([augustOut, july, augustIn], "Housing").map((point) => [point.key, point.net]),
      [["2026-08-20", -900]],
    );
  });

  it("nets a bucket below zero when spending outruns income", () => {
    const rows = [
      {
        id: "1",
        merchant: "Refund",
        category: "Shopping",
        tags: ["Shopping"],
        date: "2 Aug",
        dateIso: "2026-08-02",
        amount: 40,
        type: "refund" as const,
        sourceFile: "demo",
        confidence: 1,
      },
      {
        id: "2",
        merchant: "Rent",
        category: "Housing",
        tags: ["Housing"],
        date: "2 Aug",
        dateIso: "2026-08-02",
        amount: -900,
        type: "expense" as const,
        sourceFile: "demo",
        confidence: 1,
      },
    ];
    assert.deepEqual(
      tagFlowOverTime(rows).map((point) => [point.income, point.spending, point.net]),
      [[40, 900, -860]],
    );
  });

  it("moves spend onto a replacement tag", () => {
    const before = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Rent Payment Smith",
        category: "Housing",
        tags: ["Housing"],
        date: "1 Aug",
        dateIso: "2026-08-01",
        amount: -980,
        type: "expense",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    const after = summarizeMoneyFlow([
      {
        id: "1",
        merchant: "Rent Payment Smith",
        category: "Rent",
        tags: ["Rent"],
        date: "1 Aug",
        dateIso: "2026-08-01",
        amount: -980,
        type: "expense",
        sourceFile: "demo",
        confidence: 1,
      },
    ]);
    assert.deepEqual(
      before.categories.map((category) => category.name),
      ["Housing"],
    );
    assert.deepEqual(
      after.categories.map((category) => [category.name, category.amount]),
      [["Rent", 980]],
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
