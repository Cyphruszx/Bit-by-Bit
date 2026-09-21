import type { IngestChannel } from "@/lib/money-flow/core-ingest";
import { ingestQuotasDisabled, OCR_PAGE_WEEKLY_LIMIT } from "@/lib/money-flow/core-ingest";

export const INTERPRET_EMPTY_ERROR = "Choose a CSV, PDF, or photo to interpret.";

export const UPLOAD_STUDIO_HEADING = "Drop a CSV, PDF, or photo";

export const UPLOAD_ACCOUNTS_DETAIL = "CSV, PDF, and OCR photos";

export const NO_MOVEMENT_ERROR = "No money movement found. Try a bank CSV, a digital PDF, or a clearer photo.";

const SIZE_GUIDANCE = "Keep CSV around 5MB and PDFs and photos around 10MB.";

export function uploadPageIntro(): string {
  const confirm = ingestQuotasDisabled()
    ? "Preview the mapped rows, then Confirm. Testing — weekly quotas are off."
    : "Preview the mapped rows, then Confirm — a CSV slot is used only then.";
  return `Core ingest is CSV, digital PDF, and OCR photos. Drop one bank CSV, a PDF, or photograph a page. Digital PDFs are text-extracted when the text is usable; scanned pages use OCR. ${confirm} Excel, OFX, and QIF are unavailable. ${SIZE_GUIDANCE}`;
}

export function uploadStudioBody(): string {
  if (ingestQuotasDisabled()) {
    return `Core ingest is CSV, digital PDF, and OCR photos — one file at a time. Excel, OFX, and QIF are unavailable. ${SIZE_GUIDANCE} PDFs are text-extracted when the text is usable; scanned pages use OCR.`;
  }
  return `Core ingest is CSV, digital PDF, and OCR photos — one file at a time. Excel, OFX, and QIF are unavailable. PDFs under about 10MB (about ${OCR_PAGE_WEEKLY_LIMIT} pages) are text-extracted when the text is usable; scanned pages use OCR and count toward this week's ${OCR_PAGE_WEEKLY_LIMIT} OCR pages.`;
}

/** Snapshot of current-env intro copy. Prefer `uploadPageIntro()` when env can change. */
export const UPLOAD_PAGE_INTRO = uploadPageIntro();

/** Snapshot of current-env studio body. Prefer `uploadStudioBody()` when env can change. */
export const UPLOAD_STUDIO_BODY = uploadStudioBody();

export function ingestChannelLabel(kind: string | undefined, channel: IngestChannel): string {
  if (kind === "pdf") return channel === "ocr" ? "PDF · OCR" : "PDF · text";
  return channel === "csv" ? "CSV" : "OCR";
}

export function confirmChargeCopy(kind: string | undefined, channel: IngestChannel): string {
  if (ingestQuotasDisabled()) {
    if (channel === "csv") return "Confirm writes the mapped rows. Discard now and nothing is imported.";
    if (kind === "pdf") return "Confirm writes the rows from this scanned PDF.";
    return "Confirm writes the rows from this photo.";
  }
  if (channel === "csv") {
    return "A CSV slot is used only when you confirm. Discard now and nothing is charged.";
  }
  if (kind === "pdf") {
    return "OCR pages were charged when this scanned PDF was read. Confirm writes the rows.";
  }
  return "OCR pages were charged when this photo was read. Confirm writes the rows.";
}

export function ocrQuotaError(pagesNeeded: number): string {
  if (pagesNeeded > 1) {
    return `This scanned PDF needs ${pagesNeeded} OCR pages; this week's ${OCR_PAGE_WEEKLY_LIMIT} are used.`;
  }
  return `This week's ${OCR_PAGE_WEEKLY_LIMIT} OCR pages are used.`;
}
