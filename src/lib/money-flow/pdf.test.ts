import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptedDropTypes, looksLikeImageUpload } from "./accept";
import {
  confirmPreviewRows,
  createDraft,
  OCR_PAGE_WEEKLY_LIMIT,
  ocrPagesToChargeAfterInterpret,
} from "./core-ingest";
import {
  confirmChargeCopy,
  ingestChannelLabel,
  INTERPRET_EMPTY_ERROR,
  NO_MOVEMENT_ERROR,
  ocrQuotaError,
  uploadPageIntro,
  uploadStudioBody,
  UPLOAD_STUDIO_HEADING,
} from "./ingest-copy";
import { interpretDocuments } from "./interpret";
import { parseDocument } from "./parsers";
import { PDF_SOFT_MAX_BYTES, PDF_SOFT_MAX_PAGES, pdfOverSoftSize, pdfTextUsable } from "./pdf";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction } from "./types";

process.env.OPENAI_API_KEY = "";

function file(filename: string, mime: string, contents: string | Uint8Array) {
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  return { filename, mime, bytes };
}

function txn(over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id">): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: "14 Sep 2026",
    dateIso: "2026-09-14",
    amount: -4.5,
    type: "SPENDING",
    sourceFile: "statement.pdf",
    confidence: 1,
    status: "CLEARED",
    institution: "NAB",
    accountId: "NAB · 1",
    ...over,
  };
}

function interpretation(
  rows: InterpretedTransaction[],
  over: Partial<FileInterpretation> = {},
): InterpretationResult {
  const fileRow: FileInterpretation = {
    filename: over.filename ?? "statement.pdf",
    fileType: over.fileType ?? "pdf",
    kind: over.kind ?? "pdf",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    transactionCount: rows.length,
    notes: [],
    ...over,
  };
  return {
    files: [fileRow],
    transactions: rows,
    flow: {
      income: 0,
      spending: 0,
      net: 0,
      cashIn: 0,
      cashOut: 0,
      cashNet: 0,
      transfers: 0,
      actualSavings: 0,
      unmatchedInternal: 0,
      refunds: 0,
      transactionCount: rows.length,
      categories: [],
      periodLabel: "",
      insights: [],
    },
  };
}

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

describe("PDF accept and copy", () => {
  it("accepts PDF alongside CSV and images", () => {
    const accept = acceptedDropTypes();
    assert.match(accept, /\.pdf/);
    assert.match(accept, /\.csv/);
    assert.match(accept, /\.png/);
    assert.equal(looksLikeImageUpload("statement.pdf", "application/pdf"), false);
    assert.equal(looksLikeImageUpload("page.png", "image/png"), true);
  });

  it("updates upload copy and keeps Excel/OFX/QIF unavailable", () => {
    const intro = uploadPageIntro();
    const body = uploadStudioBody();
    assert.equal(UPLOAD_STUDIO_HEADING, "Drop a CSV, PDF, or photo");
    assert.match(body, /digital PDF/i);
    assert.match(intro, /digital PDF/i);
    assert.doesNotMatch(`${body} ${intro}`, /not a Core path/i);
    assert.match(body, /Excel, OFX, and QIF are unavailable/);
    assert.match(intro, /Excel, OFX, and QIF are unavailable/);
    assert.match(intro, /Testing — weekly quotas are off/);
    assert.match(intro, /5MB/);
    assert.match(body, /10MB/);
    assert.match(INTERPRET_EMPTY_ERROR, /PDF/);
    assert.match(NO_MOVEMENT_ERROR, /digital PDF/);
    assert.equal(ingestChannelLabel("pdf", "csv"), "PDF · text");
    assert.equal(ingestChannelLabel("pdf", "ocr"), "PDF · OCR");
    assert.match(confirmChargeCopy("pdf", "csv"), /nothing is imported/);
    assert.match(confirmChargeCopy("pdf", "ocr"), /scanned PDF/i);
    assert.match(ocrQuotaError(3), /3 OCR pages/);
  });

  it("restores weekly-cap copy when ingest quotas are re-enabled", () => {
    const previousPublic = process.env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED;
    process.env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED = "false";
    try {
      assert.match(uploadPageIntro(), /CSV slot/i);
      assert.match(uploadStudioBody(), /this week's/);
      assert.match(confirmChargeCopy("pdf", "csv"), /CSV slot/i);
      assert.match(confirmChargeCopy("pdf", "ocr"), /scanned PDF/i);
    } finally {
      if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED;
      else process.env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED = previousPublic;
    }
  });
});

describe("PDF text usability", () => {
  it("prefers real statement text and rejects empty or page-number scans", () => {
    assert.equal(pdfTextUsable("25/08/2026 Woolworths 86.40 DR\n18/08/2026 Salary Acme 1500.00 CR"), true);
    assert.equal(pdfTextUsable(""), false);
    assert.equal(pdfTextUsable("Page 1"), false);
    assert.equal(pdfTextUsable("   \n\t  "), false);
    assert.equal(PDF_SOFT_MAX_PAGES, OCR_PAGE_WEEKLY_LIMIT);
    assert.equal(pdfOverSoftSize(PDF_SOFT_MAX_BYTES), false);
    assert.equal(pdfOverSoftSize(PDF_SOFT_MAX_BYTES + 1), true);
  });
});

describe("PDF text-extract happy path", () => {
  it("reads a digital PDF without burning OCR pages", async () => {
    const pdf = minimalPdf("25/08/2026 Woolworths 86.40 DR\n18/08/2026 Salary Acme 1500.00 CR");
    const parsed = await parseDocument("statement.pdf", "application/pdf", pdf);
    assert.ok(parsed.transactions.length >= 1, JSON.stringify(parsed, null, 2));
    assert.equal(parsed.ocrPages, 0);
    assert.ok(parsed.notes.some((note) => /text extract/i.test(note)));

    const result = await interpretDocuments([file("statement.pdf", "application/pdf", pdf)]);
    const draft = createDraft(result);
    assert.equal(draft.channel, "csv");
    assert.equal(draft.ocrPages, 0);
    assert.equal(ocrPagesToChargeAfterInterpret(draft.ocrPages, 0), 0);
    assert.ok(result.transactions.length >= 1);
  });
});

describe("PDF OCR fallback", () => {
  it("rasterizes and OCRs when extracted text is not usable", async () => {
    let rasterized = 0;
    let ocrPages = 0;
    const parsed = await parseDocument("scan.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      pdf: {
        extractText: async () => ({ text: "Page 1", pageCount: 2 }),
        rasterize: async (_bytes, pageCount) => {
          rasterized = pageCount;
          return [new Uint8Array([1]), new Uint8Array([2])];
        },
        ocr: async () => {
          ocrPages += 1;
          return ocrPages === 1
            ? "25/08/2026 Woolworths 86.40 DR"
            : "18/08/2026 Salary Acme 1500.00 CR";
        },
      },
    });
    assert.equal(rasterized, 2);
    assert.equal(ocrPages, 2);
    assert.equal(parsed.ocrPages, 2);
    assert.ok(parsed.transactions.length >= 1, JSON.stringify(parsed, null, 2));
    assert.ok(parsed.notes.some((note) => /OCR'd each page/i.test(note)));
  });

  it("charges OCR pages after interpret on the scanned path only", async () => {
    const result = await interpretDocuments(
      [file("scan.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]))],
      {
        pdf: {
          extractText: async () => ({ text: "", pageCount: 2 }),
          rasterize: async () => [new Uint8Array([1]), new Uint8Array([2])],
          ocr: async () => "25/08/2026 Woolworths 86.40 DR",
        },
      },
    );
    assert.equal(result.files[0]?.ocrPages, 2);
    const draft = createDraft(result);
    assert.equal(draft.channel, "ocr");
    assert.equal(draft.ocrPages, 2);
    assert.equal(ocrPagesToChargeAfterInterpret(draft.ocrPages, 0), 2);
    assert.equal(ocrPagesToChargeAfterInterpret(draft.ocrPages, 1), 1);
  });

  it("caps OCR rasterize at the weekly page budget", async () => {
    let asked = 0;
    await parseDocument("long-scan.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      pdf: {
        extractText: async () => ({ text: "", pageCount: 48 }),
        rasterize: async (_bytes, pageCount) => {
          asked = pageCount;
          return Array.from({ length: pageCount }, () => new Uint8Array([1]));
        },
        ocr: async () => "25/08/2026 Woolworths 86.40 DR",
      },
    });
    assert.equal(asked, PDF_SOFT_MAX_PAGES);
  });
});

describe("PDF Confirm preview stays template-only", () => {
  it("builds a read-only mapped preview from already-interpreted PDF rows", () => {
    const draft = createDraft(
      interpretation([
        txn({
          id: "a",
          merchant: "Woolworths",
          date: "25 Aug 2026",
          dateIso: "2026-08-25",
          amount: -86.4,
        }),
      ]),
    );
    assert.equal(draft.channel, "csv");
    const preview = confirmPreviewRows(draft);
    assert.equal(preview.length, 1);
    assert.equal(preview[0]?.description, "Woolworths");
    assert.equal(preview[0]?.amount, -86.4);
    assert.equal(preview[0]?.direction, "out");
  });
});
