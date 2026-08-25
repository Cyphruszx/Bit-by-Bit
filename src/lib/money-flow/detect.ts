import type { FileKind, SchemaFileType } from "@/lib/money-flow/types";
import { decodeText } from "@/lib/money-flow/parse-values";

const EXTENSIONS: Record<string, FileKind> = {
  csv: "csv",
  tsv: "csv",
  txt: "text",
  xlsx: "xlsx",
  xls: "xlsx",
  xlsm: "xlsx",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  bmp: "image",
  ofx: "ofx",
  qfx: "ofx",
  qif: "qif",
  json: "json",
  html: "html",
  htm: "html",
  docx: "docx",
  md: "text",
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function detectFileKind(filename: string, mime: string, bytes: Uint8Array): FileKind {
  const ext = extensionOf(filename);
  const type = mime.toLowerCase();

  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image";
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image";
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image";
  }
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return "xlsx";
  }
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (ext === "docx") return "docx";
    if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "xlsx";
    if (type.includes("word")) return "docx";
    if (type.includes("sheet") || type.includes("excel")) return "xlsx";
    return ext === "docx" ? "docx" : "xlsx";
  }

  if (EXTENSIONS[ext]) return EXTENSIONS[ext];
  if (type.includes("csv")) return "csv";
  if (type.includes("pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.includes("json")) return "json";
  if (type.includes("html")) return "html";

  const head = decodeText(bytes.slice(0, 800)).trim().toLowerCase();
  if (head.includes("ofxheader") || head.includes("<ofx") || head.includes("<stmttrn")) return "ofx";
  if (head.startsWith("!type:") || head.startsWith("!account")) return "qif";
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.includes("<html") || head.includes("<table")) return "html";
  if ((head.match(/,/g) ?? []).length >= 2 || head.includes("\t")) return "csv";
  return head ? "text" : "unknown";
}

export function toSchemaFileType(kind: FileKind): SchemaFileType {
  if (kind === "csv") return "csv";
  if (kind === "xlsx") return "xlsx";
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  return "other";
}
