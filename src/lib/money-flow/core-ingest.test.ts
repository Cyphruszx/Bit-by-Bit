import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyDraft,
  auWeekKey,
  canChargeCsv,
  canChargeOcr,
  canConfirmDraft,
  confirmDraftIssues,
  confirmPreviewRows,
  CONFIRM_PREVIEW_LIMIT,
  CORE_FILES_PER_ATTEMPT,
  coreIngestUnavailable,
  createDraft,
  CSV_WEEKLY_LIMIT,
  detectedBankLabel,
  ingestChannel,
  isLaunchPreset,
  LAUNCH_BANK_PRESETS,
  memoryQuotaStore,
  needsManualMap,
  OCR_PAGE_WEEKLY_LIMIT,
  ocrPagesFor,
  peekQuota,
  persistUploadStatus,
  quotaSubject,
  tryChargeCsv,
  tryChargeOcr,
  uploadStatus,
} from "./core-ingest";
import { interpretDocuments } from "./interpret";
import { interpretMovement } from "./interpret-row";
import { resolveReviewItem } from "./review-queue";
import { mappedPreviewRows } from "./tabular";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction } from "./types";

process.env.OPENAI_API_KEY = "";

function file(filename: string, mime: string, contents: string) {
  return { filename, mime, bytes: new TextEncoder().encode(contents) };
}

function txn(over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id">): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: "14 Sep 2026",
    dateIso: "2026-09-14",
    amount: -4.5,
    type: "SPENDING",
    sourceFile: "export.csv",
    confidence: 1,
    status: "CLEARED",
    ...over,
  };
}

function interpretation(
  rows: InterpretedTransaction[],
  over: Partial<FileInterpretation> = {},
): InterpretationResult {
  const fileRow: FileInterpretation = {
    filename: over.filename ?? "export.csv",
    fileType: over.fileType ?? "csv",
    kind: over.kind ?? "csv",
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

describe("Spec 2 format gates", () => {
  it("accepts CSV and OCR only", () => {
    assert.equal(ingestChannel("csv"), "csv");
    assert.equal(ingestChannel("text"), "csv");
    assert.equal(ingestChannel("image"), "ocr");
    assert.equal(ingestChannel("xlsx"), undefined);
    assert.equal(ingestChannel("ofx"), undefined);
    assert.equal(ingestChannel("qif"), undefined);
    assert.equal(ingestChannel("pdf"), undefined);
    assert.match(coreIngestUnavailable("xlsx") ?? "", /unavailable/i);
    assert.match(coreIngestUnavailable("ofx") ?? "", /unavailable/i);
    assert.match(coreIngestUnavailable("qif") ?? "", /unavailable/i);
    assert.match(coreIngestUnavailable("pdf") ?? "", /OCR|photograph/i);
    assert.equal(coreIngestUnavailable("csv"), undefined);
    assert.equal(coreIngestUnavailable("image"), undefined);
    assert.equal(CORE_FILES_PER_ATTEMPT, 1);
    assert.equal(ocrPagesFor("csv"), 0);
    assert.equal(ocrPagesFor("image", 3), 3);
  });

  it("rejects Excel, OFX, and QIF at interpret", async () => {
    const ofx = await interpretDocuments([
      file(
        "export.ofx",
        "application/x-ofx",
        "OFXHEADER:100\n<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>",
      ),
    ]);
    assert.equal(ofx.transactions.length, 0);
    assert.match(ofx.files[0]?.processingError ?? "", /unavailable/i);

    const qif = await interpretDocuments([file("export.qif", "application/qif", "!Type:Bank\n")]);
    assert.equal(qif.transactions.length, 0);
    assert.match(qif.files[0]?.processingError ?? "", /unavailable/i);

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Date", "Amount"]]), "Sheet1");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const excel = await interpretDocuments([
      { filename: "statement.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes },
    ]);
    assert.equal(excel.transactions.length, 0);
    assert.match(excel.files[0]?.processingError ?? "", /unavailable/i);
  });
});

describe("Spec 2 quotas", () => {
  it("keys guest device id separately from signed-in user_id", () => {
    assert.equal(quotaSubject({ deviceId: "dev-1" }), "guest:dev-1");
    assert.equal(quotaSubject({ userId: "user-9", deviceId: "dev-1" }), "user:user-9");
  });

  it("uses the Australia/Sydney week, Monday start", () => {
    // Monday 14 Sep 2026 00:30 AEST = 2026-09-13T14:30:00Z
    assert.equal(auWeekKey(new Date("2026-09-13T14:30:00.000Z")), "2026-09-14");
    // Sunday 20 Sep 2026 22:00 AEST still that week
    assert.equal(auWeekKey(new Date("2026-09-20T12:00:00.000Z")), "2026-09-14");
    // Monday 21 Sep 2026 00:30 AEST is the next week
    assert.equal(auWeekKey(new Date("2026-09-20T14:30:00.000Z")), "2026-09-21");
  });

  it("charges OCR pages at intake, including failures, and never page-counts CSV", () => {
    const store = memoryQuotaStore();
    const guest = quotaSubject({ deviceId: "phone" });
    const at = new Date("2026-09-14T04:00:00.000Z");
    const failedPages = tryChargeOcr(store, guest, 4, at);
    assert.equal(failedPages.ok, true);
    assert.equal(failedPages.usage.ocrPages, 4);
    assert.equal(failedPages.usage.csv, 0);
    assert.equal(ocrPagesFor("csv", 99), 0);
    assert.equal(canChargeOcr(failedPages.usage, OCR_PAGE_WEEKLY_LIMIT - 3), false);
    assert.equal(canChargeCsv(failedPages.usage), true);
  });

  it("charges a CSV slot only on Confirm, not when the mapper is abandoned", () => {
    const store = memoryQuotaStore();
    const user = quotaSubject({ userId: "u1" });
    const at = new Date("2026-09-14T04:00:00.000Z");
    const draft = createDraft(interpretation([txn({ id: "a", institution: "NAB", accountId: "NAB · 1" })]));
    assert.equal(draft.channel, "csv");
    assert.equal(canConfirmDraft(draft), true);
    assert.equal(peekQuota(store, user, at).csv, 0);

    // Abandon: no charge.
    assert.equal(peekQuota(store, user, at).csv, 0);

    const confirmed = tryChargeCsv(store, user, at);
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.usage.csv, 1);
    applyDraft(draft);
    assert.equal(peekQuota(store, user, at).csv, 1);
  });

  it("stops a sixth CSV and a 21st OCR page in the same AU week", () => {
    const store = memoryQuotaStore();
    const subject = quotaSubject({ deviceId: "limit" });
    const at = new Date("2026-09-14T04:00:00.000Z");
    for (let i = 0; i < CSV_WEEKLY_LIMIT; i += 1) {
      assert.equal(tryChargeCsv(store, subject, at).ok, true);
    }
    assert.equal(tryChargeCsv(store, subject, at).ok, false);
    assert.equal(tryChargeOcr(store, subject, OCR_PAGE_WEEKLY_LIMIT, at).ok, true);
    assert.equal(tryChargeOcr(store, subject, 1, at).ok, false);
  });

  it("does not re-consume quota when Review Queue resolves", () => {
    const store = memoryQuotaStore();
    const subject = quotaSubject({ userId: "rq" });
    const at = new Date("2026-09-14T04:00:00.000Z");
    tryChargeCsv(store, subject, at);
    const before = peekQuota(store, subject, at);
    resolveReviewItem({
      id: "UNPAIRED_TRANSFER:a~b",
      reason: "UNPAIRED_TRANSFER",
      state: "OPEN",
      movementIds: ["a", "b"],
      label: "Transfer",
    });
    assert.deepEqual(peekQuota(store, subject, at), before);
  });
});

describe("Spec 2 Confirm and mapper", () => {
  it("sends an unknown bank to manual map and keeps launch presets", () => {
    assert.deepEqual(LAUNCH_BANK_PRESETS, [
      "Up",
      "NAB",
      "Commonwealth Bank",
      "ANZ",
      "Westpac",
      "Bendigo Bank",
      "ING",
      "Macquarie",
    ]);
    assert.equal(isLaunchPreset("NAB"), true);
    assert.equal(needsManualMap(undefined), true);
    const draft = createDraft(interpretation([txn({ id: "a" })]));
    assert.equal(draft.institution, "");
    assert.equal(canConfirmDraft(draft), false);
    draft.institution = "Westpac";
    assert.equal(canConfirmDraft(draft), true);
    assert.equal(applyDraft(draft).transactions[0]?.institution, "Westpac");
  });

  it("commits a single-account draft and buffers a multi-account file until every section is assigned", () => {
    const single = createDraft(
      interpretation([txn({ id: "a", institution: "NAB", accountId: "NAB · everyday" })]),
    );
    assert.equal(single.sections.length, 1);
    assert.equal(canConfirmDraft(single), true);

    const multi = createDraft(
      interpretation([
        txn({ id: "a", institution: "NAB", accountId: "NAB · everyday" }),
        txn({ id: "b", institution: "NAB", accountId: "NAB · offset", amount: -12 }),
      ]),
    );
    assert.equal(multi.sections.length, 2);
    assert.equal(canConfirmDraft(multi), false);
    multi.sections[0].assignedTo = "NAB · everyday";
    assert.equal(canConfirmDraft(multi), false);
    multi.sections[1].assignedTo = "NAB · offset";
    assert.equal(canConfirmDraft(multi), true);
  });

  it("blocks Confirm when nothing mapped, and surfaces parse notes as warnings", () => {
    const empty = createDraft(interpretation([], { processingError: "No money movement found." }));
    assert.equal(empty.result.transactions.length, 0);
    assert.equal(canConfirmDraft(empty), false);
    assert.equal(detectedBankLabel(empty), "Unknown");
    const issues = confirmDraftIssues(empty);
    assert.ok(issues.some((issue) => issue.severity === "block" && /0 movements/i.test(issue.message)));
    assert.ok(issues.some((issue) => issue.severity === "block" && /No money movement found/i.test(issue.message)));
    assert.deepEqual(confirmPreviewRows(empty), []);

    const noted = createDraft(
      interpretation([txn({ id: "a", institution: "NAB", accountId: "NAB · 1" })], {
        notes: ["Read as a NAB account export."],
      }),
    );
    assert.equal(canConfirmDraft(noted), true);
    assert.deepEqual(
      confirmDraftIssues(noted).filter((issue) => issue.severity === "warn").map((issue) => issue.message),
      ["Read as a NAB account export."],
    );
  });

  it("builds a read-only preview from already-mapped draft movements", () => {
    const draft = createDraft(
      interpretation([
        txn({
          id: "a",
          institution: "NAB",
          accountId: "NAB · everyday",
          merchant: "Medicare",
          date: "29 Jun 2026",
          dateIso: "2026-06-29",
          amount: 662.4,
        }),
        txn({
          id: "b",
          institution: "NAB",
          accountId: "NAB · offset",
          merchant: "Interest charged",
          date: "30 Jun 2026",
          dateIso: "2026-06-30",
          amount: -0.61,
        }),
      ]),
    );
    draft.sections[0].assignedTo = "Everyday";
    draft.sections[1].assignedTo = "Offset";
    const preview = confirmPreviewRows(draft);
    assert.equal(preview.length, 2);
    assert.deepEqual(preview[0], {
      id: "a",
      date: "29 Jun 2026",
      description: "Medicare",
      amount: 662.4,
      direction: "in",
      account: "Everyday",
    });
    assert.equal(preview[1].direction, "out");
    assert.equal(preview[1].account, "Offset");
    assert.equal(mappedPreviewRows(draft.result.transactions, { showAccount: false })[0]?.account, undefined);
  });
});

const samples = path.join(process.cwd(), "public/samples");

describe("Spec 2 Confirm preview against sample files", () => {
  it("maps NAB and Up sample files into a confirmable preview", async () => {
    const nabMedicare = await interpretDocuments([
      {
        filename: "nab-medicare.csv",
        mime: "text/csv",
        bytes: new Uint8Array(readFileSync(path.join(samples, "nab-medicare.csv"))),
      },
    ]);
    const nabDraft = createDraft(nabMedicare);
    assert.equal(detectedBankLabel(nabDraft), "NAB");
    assert.equal(nabDraft.channel, "csv");
    assert.equal(canConfirmDraft(nabDraft), true);
    assert.equal(nabMedicare.transactions.length, 378);
    const nabPreview = confirmPreviewRows(nabDraft);
    assert.equal(nabPreview.length, CONFIRM_PREVIEW_LIMIT);
    assert.ok(nabPreview.every((row) => row.date && row.description && typeof row.amount === "number"));
    const nabFirst = nabMedicare.transactions[0];
    assert.equal(nabPreview[0]?.id, nabFirst?.id);
    assert.equal(nabPreview[0]?.description, nabFirst?.merchant);
    assert.equal(nabPreview[0]?.amount, nabFirst?.amount);

    const nabRent = await interpretDocuments([
      {
        filename: "nab-rent.csv",
        mime: "text/csv",
        bytes: new Uint8Array(readFileSync(path.join(samples, "nab-rent.csv"))),
      },
    ]);
    const rentDraft = createDraft(nabRent);
    assert.equal(detectedBankLabel(rentDraft), "NAB");
    assert.equal(canConfirmDraft(rentDraft), true);
    assert.equal(nabRent.transactions.length, 59);
    assert.equal(nabMedicare.transactions.length + nabRent.transactions.length, 437);

    const up = await interpretDocuments([
      {
        filename: "up-2025-07-to-2026-06.txt",
        mime: "text/plain",
        bytes: new Uint8Array(readFileSync(path.join(samples, "up-2025-07-to-2026-06.txt"))),
      },
    ]);
    const upDraft = createDraft(up);
    assert.equal(detectedBankLabel(upDraft), "Up");
    assert.equal(up.transactions.length, 1267);
    assert.ok(upDraft.sections.length > 1, "Up year sample has several saver accounts");
    assert.equal(canConfirmDraft(upDraft), false);
    upDraft.sections = upDraft.sections.map((section) => ({ ...section, assignedTo: section.accountId }));
    assert.equal(canConfirmDraft(upDraft), true);
    const upPreview = confirmPreviewRows(upDraft);
    assert.equal(upPreview.length, CONFIRM_PREVIEW_LIMIT);
    assert.ok(upPreview.every((row) => row.account));
    const kfc = up.transactions.find((row) => row.dateIso === "2026-06-30" && row.amount === -14.95 && row.merchant === "KFC");
    assert.ok(kfc, "Up sample still reads the 30 Jun 2026 KFC $14.95 purchase");
    assert.ok(upPreview.some((row) => row.description === "KFC" && row.amount === -14.95));
  });
});

describe("Spec 2 upload status", () => {
  it("writes CLEARED or DUPLICATE_HOLD and never PENDING", () => {
    assert.equal(uploadStatus(false), "CLEARED");
    assert.equal(uploadStatus(true), "DUPLICATE_HOLD");
    assert.equal(persistUploadStatus("PENDING"), "CLEARED");
    assert.equal(persistUploadStatus(undefined), "CLEARED");
    assert.equal(persistUploadStatus("HOLD"), "HOLD");
    const row = interpretMovement({
      dateIso: "2026-09-14",
      amount: -4.5,
      directionKnown: true,
      description: "Cafe",
      sourceFile: "export.csv",
      id: "row-1",
      confidence: 1,
    });
    assert.equal(row.status, "CLEARED");
    assert.notEqual(row.status, "PENDING");
  });
});
