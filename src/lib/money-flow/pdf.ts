/** Soft size guidance for PDF ingest. Hard cap stays `MAX_FILE_BYTES` (12MB). */
export const PDF_SOFT_MAX_BYTES = 10 * 1024 * 1024;
/** Soft page cap; keep aligned with `OCR_PAGE_WEEKLY_LIMIT` on the scanned path. */
export const PDF_SOFT_MAX_PAGES = 20;

export type ExtractedPdfText = {
  text: string;
  pageCount: number;
};

export type PdfReadOptions = {
  extractText?: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
  rasterize?: (bytes: Uint8Array, pageCount: number) => Promise<Uint8Array[]>;
  ocr?: (image: Uint8Array) => Promise<string>;
};

/**
 * Digital PDFs usually carry selectable text. Scanned pages come back empty or as
 * a few page numbers — not enough to prefer text extract over OCR.
 */
export function pdfTextUsable(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 20) return false;
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  const digits = (compact.match(/\d/g) ?? []).length;
  return letters >= 12 && digits >= 4;
}

export function pdfOverSoftSize(byteLength: number): boolean {
  return byteLength > PDF_SOFT_MAX_BYTES;
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText> {
  const { extractText } = await import("unpdf");
  const extracted = await extractText(bytes.slice(), { mergePages: true });
  const text = typeof extracted.text === "string" ? extracted.text : extracted.text.join("\n");
  return { text, pageCount: Math.max(1, extracted.totalPages || 1) };
}

export async function rasterizePdfPages(bytes: Uint8Array, pageCount: number): Promise<Uint8Array[]> {
  const { definePDFJSModule, getDocumentProxy, renderPageAsImage } = await import("unpdf");
  await definePDFJSModule(() => import("pdfjs-dist"));
  const pages = Math.min(Math.max(pageCount, 1), PDF_SOFT_MAX_PAGES);
  const pdf = await getDocumentProxy(bytes.slice());
  const images: Uint8Array[] = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const rendered = await renderPageAsImage(pdf, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: 1.5,
    });
    images.push(new Uint8Array(rendered));
  }
  return images;
}
