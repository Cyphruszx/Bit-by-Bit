import type { IngestChannel } from "@/lib/money-flow/core-ingest";
import { OCR_PAGE_WEEKLY_LIMIT } from "@/lib/money-flow/core-ingest";
import { PDF_SOFT_MAX_PAGES } from "@/lib/money-flow/pdf";

export const INTERPRET_EMPTY_ERROR = "Choose a CSV, PDF, or photo to interpret.";

export const UPLOAD_PAGE_INTRO =
  "Core ingest is CSV, digital PDF, and OCR photos. Drop one bank CSV, a PDF, or photograph a page. Digital PDFs are text-extracted when the text is usable; scanned pages use OCR. Preview the mapped rows, then Confirm — a CSV slot is used only then. Excel, OFX, and QIF are unavailable.";

export const UPLOAD_STUDIO_HEADING = "Drop a CSV, PDF, or photo";

export const UPLOAD_STUDIO_BODY = `Core ingest is CSV, digital PDF, and OCR photos — one file at a time. Excel, OFX, and QIF are unavailable. PDFs under about 10MB (about ${PDF_SOFT_MAX_PAGES} pages) are text-extracted when the text is usable; scanned pages use OCR and count toward this week's ${OCR_PAGE_WEEKLY_LIMIT} OCR pages.`;

export const UPLOAD_ACCOUNTS_DETAIL = "CSV, PDF, and OCR photos";

export const NO_MOVEMENT_ERROR = "No money movement found. Try a bank CSV, a digital PDF, or a clearer photo.";

export function ingestChannelLabel(kind: string | undefined, channel: IngestChannel): string {
  if (kind === "pdf") return channel === "ocr" ? "PDF · OCR" : "PDF · text";
  return channel === "csv" ? "CSV" : "OCR";
}

export function confirmChargeCopy(kind: string | undefined, channel: IngestChannel): string {
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
