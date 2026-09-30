/**
 * Spec 2A.1. CSV is the only upload. Fiskil stays a separate, non-upload path.
 *
 * The server checks the extension, the declared MIME type, and the opening
 * bytes. A rejection is HTTP 415 UNSUPPORTED_FILE_TYPE — not a ledger batch,
 * not a quota charge, and not a Review item.
 *
 * PDF and photo uploads reach the archived reader only when INGEST_PDF_ENABLED
 * is on. OFX/QFX never do.
 */

import { decodeText } from "@/lib/money-flow/parse-values";

export const UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE";

export const PDF_REJECTED_COPY =
  "We can't read PDF statements. Download a CSV file from your bank's app or internet banking and upload that instead.";

export const IMAGE_REJECTED_COPY =
  "We can't read photos or screenshots. Download a CSV file from your bank's app or internet banking and upload that instead.";

export const OFX_REJECTED_COPY =
  "We can't read OFX or QFX files. Download a CSV file from your bank's app or internet banking and upload that instead.";

export const OTHER_REJECTED_COPY =
  "That file type isn't supported. Download a CSV file from your bank's app or internet banking and upload that instead.";

export const OPEN_BANKING_UPLOAD_HINT =
  "Or connect your bank so transactions come in automatically.";

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "webp",
  "gif",
  "tif",
  "tiff",
  "bmp",
]);

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "qif"]);

export type UploadRejectCase = "pdf" | "image" | "ofx" | "other";

export type UploadDecision =
  | { ok: true; kind: "csv" | "pdf" | "image" }
  | { ok: false; code: typeof UNSUPPORTED_FILE_TYPE; case: UploadRejectCase; message: string };

export function rejectionCopy(kind: UploadRejectCase, openBanking = false): string {
  const base =
    kind === "pdf"
      ? PDF_REJECTED_COPY
      : kind === "image"
        ? IMAGE_REJECTED_COPY
        : kind === "ofx"
          ? OFX_REJECTED_COPY
          : OTHER_REJECTED_COPY;
  return openBanking ? `${base}\n${OPEN_BANKING_UPLOAD_HINT}` : base;
}

export function classifyUpload(
  filename: string,
  mime: string,
  bytes: Uint8Array,
  options: { pdfEnabled?: boolean; openBanking?: boolean } = {},
): UploadDecision {
  const kind = sniffUpload(filename, mime, bytes);
  const pdfEnabled = options.pdfEnabled === true;
  if (kind === "csv") return { ok: true, kind: "csv" };
  if (pdfEnabled && (kind === "pdf" || kind === "image")) return { ok: true, kind };
  const rejectCase: UploadRejectCase =
    kind === "pdf" || kind === "image" || kind === "ofx" ? kind : "other";
  return {
    ok: false,
    code: UNSUPPORTED_FILE_TYPE,
    case: rejectCase,
    message: rejectionCopy(rejectCase, options.openBanking === true),
  };
}

/** File-picker accept list. PDF and images join it only while the flag is on. */
export function acceptedUploadTypes(pdfEnabled: boolean): string {
  if (!pdfEnabled) return ".csv";
  return [".csv", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff", ".bmp"].join(
    ",",
  );
}

function sniffUpload(filename: string, mime: string, bytes: Uint8Array): "csv" | "pdf" | "image" | "ofx" | "other" {
  const ext = extensionOf(filename);
  const type = mime.toLowerCase();

  if (isPdfBytes(bytes)) return "pdf";
  if (isImageBytes(bytes)) return "image";
  if (isOfxBytes(bytes)) return "ofx";
  if (isExcelBytes(bytes) || isQifBytes(bytes)) return "other";

  if (ext === "pdf" || type.includes("pdf")) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext) || type.startsWith("image/")) return "image";
  if (ext === "ofx" || ext === "qfx" || type.includes("ofx") || type.includes("qfx")) return "ofx";
  if (SPREADSHEET_EXTENSIONS.has(ext) || type.includes("excel") || type.includes("spreadsheet") || type.includes("qif")) {
    return "other";
  }
  if (ext === "csv" || type.includes("csv")) return "csv";
  return "other";
}

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return true;
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return true;
  }
  return isHeifBytes(bytes);
}

function isHeifBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
  return brand === "heic" || brand === "heix" || brand === "hevc" || brand === "heif" || brand === "mif1" || brand === "msf1";
}

function isExcelBytes(bytes: Uint8Array): boolean {
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return true;
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isOfxBytes(bytes: Uint8Array): boolean {
  const head = decodeText(bytes.slice(0, 800)).trim().toLowerCase();
  return head.includes("ofxheader") || head.includes("<ofx");
}

function isQifBytes(bytes: Uint8Array): boolean {
  const head = decodeText(bytes.slice(0, 200)).trim().toLowerCase();
  return head.startsWith("!type:") || head.startsWith("!account");
}
