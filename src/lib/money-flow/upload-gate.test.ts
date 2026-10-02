import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST } from "@/app/api/v1/ingest/upload/route";
import { coreIngestUnavailable } from "./core-ingest";
import { ingestPdfEnabled } from "./ingest-pdf-flag";
import { interpretDocuments } from "./interpret";
import {
  IMAGE_REJECTED_COPY,
  OFX_REJECTED_COPY,
  OPEN_BANKING_UPLOAD_HINT,
  OTHER_REJECTED_COPY,
  PDF_REJECTED_COPY,
  UNSUPPORTED_FILE_TYPE,
  acceptedUploadTypes,
  classifyUpload,
} from "./upload-gate";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x31]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CSV = new TextEncoder().encode("Date,Amount,Description\n2026-09-01,-12.00,Cafe\n");

function upload(name: string, type: string, bytes: Uint8Array, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", new File([Buffer.from(bytes)], name, { type }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(new Request("http://localhost/api/v1/ingest/upload", { method: "POST", body: form }));
}

describe("Spec 2A.1 upload gate", () => {
  it("defaults the PDF flag off", () => {
    const previous = process.env.INGEST_PDF_ENABLED;
    delete process.env.INGEST_PDF_ENABLED;
    try {
      assert.equal(ingestPdfEnabled(), false);
      assert.equal(ingestPdfEnabled({ INGEST_PDF_ENABLED: "" }), false);
      assert.equal(ingestPdfEnabled({ INGEST_PDF_ENABLED: "false" }), false);
      assert.equal(ingestPdfEnabled({ INGEST_PDF_ENABLED: "true" }), true);
    } finally {
      if (previous === undefined) delete process.env.INGEST_PDF_ENABLED;
      else process.env.INGEST_PDF_ENABLED = previous;
    }
  });

  it("offers only CSV in the picker while the flag is off", () => {
    assert.equal(acceptedUploadTypes(false), ".csv");
    assert.match(acceptedUploadTypes(true), /\.pdf/);
    assert.match(acceptedUploadTypes(true), /\.png/);
    assert.doesNotMatch(acceptedUploadTypes(true), /\.ofx/);
  });

  it("rejects PDF, images, OFX, and other files by content, with the 2A.1 copy", () => {
    const pdf = classifyUpload("statement.csv", "text/csv", PDF);
    assert.equal(pdf.ok, false);
    if (!pdf.ok) {
      assert.equal(pdf.code, UNSUPPORTED_FILE_TYPE);
      assert.equal(pdf.message, PDF_REJECTED_COPY);
    }

    const photo = classifyUpload("page.csv", "text/csv", PNG);
    assert.equal(photo.ok, false);
    if (!photo.ok) assert.equal(photo.message, IMAGE_REJECTED_COPY);

    const ofx = classifyUpload(
      "export.csv",
      "text/csv",
      new TextEncoder().encode("OFXHEADER:100\n<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>"),
    );
    assert.equal(ofx.ok, false);
    if (!ofx.ok) assert.equal(ofx.message, OFX_REJECTED_COPY);

    const qfx = classifyUpload(
      "export.qfx",
      "application/vnd.intu.qfx",
      new TextEncoder().encode("<?xml version=\"1.0\"?>\n<OFX></OFX>"),
    );
    assert.equal(qfx.ok, false);
    if (!qfx.ok) assert.equal(qfx.case, "ofx");

    const excel = classifyUpload("book.xlsx", "application/vnd.ms-excel", new TextEncoder().encode("Date,Amount"));
    assert.equal(excel.ok, false);
    if (!excel.ok) assert.equal(excel.message, OTHER_REJECTED_COPY);

    const named = classifyUpload("notes.txt", "text/plain", CSV);
    assert.equal(named.ok, false);
    if (!named.ok) assert.equal(named.message, OTHER_REJECTED_COPY);
  });

  it("accepts a CSV and, only with the flag, a PDF — never OFX", () => {
    const csv = classifyUpload("export.csv", "text/csv", CSV);
    assert.equal(csv.ok, true);

    const hiddenPdf = classifyUpload("statement.pdf", "application/pdf", PDF, { pdfEnabled: true });
    assert.equal(hiddenPdf.ok, true);

    const stillOfx = classifyUpload(
      "export.ofx",
      "application/x-ofx",
      new TextEncoder().encode("OFXHEADER:100\n<OFX></OFX>"),
      { pdfEnabled: true },
    );
    assert.equal(stillOfx.ok, false);

    const withBundle = classifyUpload("page.png", "image/png", PNG, { openBanking: true });
    assert.equal(withBundle.ok, false);
    if (!withBundle.ok) {
      assert.match(withBundle.message, /photos or screenshots/);
      assert.match(withBundle.message, new RegExp(OPEN_BANKING_UPLOAD_HINT));
    }
  });

  it("does not parse PDF, images, or OFX from interpret while the flag is off", async () => {
    assert.match(coreIngestUnavailable("pdf") ?? "", /PDF statements/);
    assert.match(coreIngestUnavailable("image") ?? "", /photos or screenshots/);
    assert.match(coreIngestUnavailable("ofx") ?? "", /OFX or QFX/);
    assert.match(coreIngestUnavailable("xlsx") ?? "", /isn't supported/);
    assert.equal(coreIngestUnavailable("csv"), undefined);

    const pdf = await interpretDocuments([{ filename: "statement.pdf", mime: "application/pdf", bytes: PDF }]);
    assert.equal(pdf.transactions.length, 0);
    assert.match(pdf.files[0]?.processingError ?? "", /PDF statements/);

    const photo = await interpretDocuments([{ filename: "page.png", mime: "image/png", bytes: PNG }]);
    assert.equal(photo.transactions.length, 0);
    assert.match(photo.files[0]?.processingError ?? "", /photos or screenshots/);
  });

  it("returns HTTP 415 and does not import the file", async () => {
    const pdf = await upload("statement.pdf", "application/pdf", PDF);
    assert.equal(pdf.status, 415);
    const pdfBody = (await pdf.json()) as { ok: boolean; code: string; message: string };
    assert.equal(pdfBody.ok, false);
    assert.equal(pdfBody.code, UNSUPPORTED_FILE_TYPE);
    assert.equal(pdfBody.message, PDF_REJECTED_COPY);

    const ofx = await upload(
      "export.ofx",
      "application/x-ofx",
      new TextEncoder().encode("OFXHEADER:100\n<OFX><STMTTRN><TRNAMT>10</TRNAMT><NAME>Cafe</NAME></STMTTRN></OFX>"),
      { openBanking: "true" },
    );
    assert.equal(ofx.status, 415);
    const ofxBody = (await ofx.json()) as { code: string; message: string };
    assert.equal(ofxBody.code, UNSUPPORTED_FILE_TYPE);
    assert.match(ofxBody.message, /OFX or QFX/);
    assert.match(ofxBody.message, /connect your bank/);

    const image = await upload("shot.png", "image/png", PNG);
    assert.equal(image.status, 415);
    const imageBody = (await image.json()) as { message: string };
    assert.equal(imageBody.message, IMAGE_REJECTED_COPY);

    const other = await upload("notes.txt", "text/plain", new TextEncoder().encode("hello"));
    assert.equal(other.status, 415);

    const csv = await upload("export.csv", "text/csv", CSV);
    assert.equal(csv.status, 200);
    const csvBody = (await csv.json()) as { ok: boolean; transactions: unknown[] };
    assert.equal(csvBody.ok, true);
    assert.equal(csvBody.transactions.length, 1);
  });
});
