import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { detectFileKind } from "./detect";
import { interpretDocuments } from "./interpret";
import { parseAmount, parseDate } from "./parse-values";
import { summarizeMoneyFlow } from "./summary";

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
