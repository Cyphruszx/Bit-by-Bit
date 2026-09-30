import { type MoneyFlowAi, visionMime } from "@/lib/money-flow/ai";
import { tidyMerchant } from "@/lib/money-flow/categorize";
import { detectFileKind } from "@/lib/money-flow/detect";
import { readMovement } from "@/lib/money-flow/interpret-row";
import { accountRefFromText } from "@/lib/money-flow/account-identity";
import { identifyAccounts } from "@/lib/money-flow/accounts";
import { detectInstitution, type InstitutionSignals } from "@/lib/money-flow/institution";
import { classifyKnownInternalTransfers } from "@/lib/money-flow/internal-transfers";
import { decodeText, formatDisplayDate, isNoticeLine, parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import {
  extractPdfText,
  pdfOverSoftSize,
  pdfTextUsable,
  PDF_SOFT_MAX_PAGES,
  rasterizePdfPages,
  type PdfReadOptions,
} from "@/lib/money-flow/pdf";
import { readBankSource } from "@/lib/money-flow/bank-filter";
import { sourceFromPairs } from "@/lib/money-flow/source";
import { interpretTable, rowsFromCsv } from "@/lib/money-flow/tabular";
import { printedOpeningBalance, transactionsFromText } from "@/lib/money-flow/text-lines";
import type { InterpretedTransaction, StatedAccountBalance } from "@/lib/money-flow/types";
import { looksLikeUpStatement, type UpPrintedBalance } from "@/lib/money-flow/up-statement";

export type ParsedDocument = {
  transactions: InterpretedTransaction[];
  notes: string[];
  ocrPages?: number;
  statedBalance?: number;
  balanceSource?: "header" | "ofx_ledger";
  balanceAsOf?: string;
  openingBalance?: number;
  statedAccounts?: StatedAccountBalance[];
};

export type ParseDocumentOptions = {
  ai?: MoneyFlowAi | null;
  pdf?: PdfReadOptions;
};

export async function parseDocument(
  filename: string,
  mime: string,
  bytes: Uint8Array,
  options: ParseDocumentOptions = {},
): Promise<ParsedDocument> {
  const kind = detectFileKind(filename, mime, bytes);
  const notes: string[] = [];

  if (kind === "csv") {
    const table = interpretTable(rowsFromCsv(decodeText(bytes)), filename);
    return stamped(table, { headers: table.headers, filename });
  }
  if (kind === "json") {
    return stamped(parseJson(decodeText(bytes), filename), { filename });
  }
  if (kind === "ofx") {
    const text = decodeText(bytes);
    const ledgerBal = ofxLedgerBalance(text);
    return stamped(
      {
        transactions: parseOfx(text, filename),
        notes,
        ...(ledgerBal
          ? {
              statedBalance: ledgerBal.amount,
              balanceSource: "ofx_ledger" as const,
              ...(ledgerBal.asOf ? { balanceAsOf: ledgerBal.asOf } : {}),
            }
          : {}),
      },
      { org: ofxOrg(text), text, filename },
    );
  }
  if (kind === "qif") {
    return stamped({ transactions: parseQif(decodeText(bytes), filename), notes }, { filename });
  }
  if (kind === "html") {
    const html = decodeText(bytes);
    const tableRows = tablesFromHtml(html);
    const fromTables = tableRows.map((rows) => interpretTable(rows, filename));
    const tableTransactions = fromTables.flatMap((result) => result.transactions);
    if (tableTransactions.length > 0) {
      const statedBalance = fromTables.map((result) => result.statedBalance).find((value) => value != null);
      return stamped(
        {
          transactions: tableTransactions,
          notes: fromTables.flatMap((result) => result.notes),
          ...(statedBalance != null ? { statedBalance, balanceSource: "header" as const } : {}),
        },
        { text: html, headers: fromTables.flatMap((result) => result.headers), filename },
      );
    }
    return stamped(extractedDocument(stripTags(html), filename, notesForText(html)), { text: html, filename });
  }
  if (kind === "text") {
    const text = decodeText(bytes);
    return stamped(extractedDocument(text, filename, notesForText(text)), { text, filename });
  }
  if (kind === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheets = workbook.SheetNames.map((name) => {
      const worksheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, { header: 1, raw: true, defval: "" });
      const sheet = interpretTable(rows, `${filename} · ${name}`);
      return {
        ...sheet,
        transactions: identifyAccounts(
          sheet.transactions,
          detectInstitution({ headers: sheet.headers, filename }),
        ),
      };
    });
    const transactions = classifyKnownInternalTransfers(sheets.flatMap((sheet) => sheet.transactions));
    const sheetNotes = sheets.flatMap((sheet) => sheet.notes);
    if (workbook.SheetNames.length > 1) sheetNotes.unshift(`Read ${workbook.SheetNames.length} sheets`);
    const statedBalance = sheets.map((sheet) => sheet.statedBalance).find((value) => value != null);
    return {
      transactions,
      notes: sheetNotes,
      ...(statedBalance != null ? { statedBalance, balanceSource: "header" as const } : {}),
    };
  }
  if (kind === "pdf") {
    return readPdfDocument(filename, bytes, options);
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return stamped(extractedDocument(result.value, filename, notesForText(result.value)), {
      text: result.value,
      filename,
    });
  }
  if (kind === "image") {
    return stamped(await readImageDocument(filename, mime, bytes, options.ai), { filename });
  }

  const fallback = decodeText(bytes);
  return stamped(extractedDocument(fallback, filename, notesForText(fallback)), { text: fallback, filename });
}

/**
 * Archived with Spec 2A. Upload reaches this only when INGEST_PDF_ENABLED is on.
 * While the flag is off, interpret and POST /api/v1/ingest/upload return 415 first.
 */
async function readPdfDocument(
  filename: string,
  bytes: Uint8Array,
  options: ParseDocumentOptions,
): Promise<ParsedDocument> {
  const notes: string[] = [];
  if (pdfOverSoftSize(bytes.byteLength)) {
    notes.push("This PDF is larger than 10MB. Try a smaller export if reading is slow.");
  }

  let text = "";
  let pageCount = 1;
  try {
    const extracted = await (options.pdf?.extractText ?? extractPdfText)(bytes);
    text = extracted.text.trim();
    pageCount = extracted.pageCount;
  } catch (error) {
    notes.push(
      `Could not read PDF text (${error instanceof Error ? error.message : "unknown error"}). Trying OCR.`,
    );
  }

  if (pdfTextUsable(text)) {
    return {
      ...stamped(
        extractedDocument(text, filename, [...notes, ...notesForText(text), "Read as a digital PDF (text extract)."]),
        { text, filename },
      ),
      ocrPages: 0,
    };
  }

  notes.push("This PDF has little usable text, so BitbyBit OCR'd each page.");
  const capped = Math.min(Math.max(pageCount, 1), PDF_SOFT_MAX_PAGES);
  if (pageCount > PDF_SOFT_MAX_PAGES) {
    notes.push(`Only the first ${PDF_SOFT_MAX_PAGES} pages were OCR'd.`);
  }

  let images: Uint8Array[];
  try {
    images = await (options.pdf?.rasterize ?? rasterizePdfPages)(bytes, capped);
  } catch (error) {
    return {
      transactions: [],
      notes: [
        ...notes,
        `Could not rasterize this PDF for OCR (${error instanceof Error ? error.message : "unknown error"}).`,
      ],
      ocrPages: 0,
    };
  }

  const pages = await Promise.all(
    images.map((image, index) =>
      readImageDocument(`${filename} · p${index + 1}`, "image/png", image, options.ai, options.pdf?.ocr),
    ),
  );
  const transactions = pages.flatMap((page) => page.transactions);
  const pageNotes = pages.flatMap((page) => page.notes);
  return {
    ...stamped({ transactions, notes: [...notes, ...pageNotes] }, { filename }),
    ocrPages: images.length,
  };
}

/** Names the bank once per document, from whatever that document happened to reveal. */
function stamped(
  result: {
    transactions: InterpretedTransaction[];
    notes: string[];
    statedBalance?: number;
    balanceSource?: "header" | "ofx_ledger";
    balanceAsOf?: string;
    openingBalance?: number;
    printedAccounts?: UpPrintedBalance[];
  },
  signals: InstitutionSignals,
): ParsedDocument {
  // The letterhead names the account for every movement that did not name its own,
  // which is how a PDF statement and a CSV export of the same account become one.
  const documentRef = signals.text ? accountRefFromText(signals.text) : {};
  const transactions = classifyKnownInternalTransfers(
    identifyAccounts(result.transactions, detectInstitution(signals), documentRef),
  );
  const statedAccounts = statedAccountsFrom(transactions, result.printedAccounts);
  return {
    transactions,
    notes: result.notes,
    ...(result.statedBalance != null ? { statedBalance: result.statedBalance } : {}),
    ...(result.balanceSource ? { balanceSource: result.balanceSource } : {}),
    ...(result.balanceAsOf ? { balanceAsOf: result.balanceAsOf } : {}),
    ...(result.openingBalance != null ? { openingBalance: result.openingBalance } : {}),
    ...(statedAccounts.length > 0 ? { statedAccounts } : {}),
  };
}

function statedAccountsFrom(
  transactions: InterpretedTransaction[],
  printed: UpPrintedBalance[] | undefined,
): StatedAccountBalance[] {
  if (!printed || printed.length === 0) return [];
  const stated: StatedAccountBalance[] = [];
  for (const row of printed) {
    if (row.closing == null) continue;
    const accountId = transactions.find((txn) => namesAccount(txn.accountId, row.accountName))?.accountId;
    if (!accountId) continue;
    stated.push({
      accountId,
      amount: row.closing,
      source: row.source,
      ...(row.opening != null ? { opening: row.opening } : {}),
    });
  }
  return stated;
}

function namesAccount(accountId: string | undefined, accountName: string): boolean {
  if (!accountId) return false;
  return accountId === accountName || accountId.endsWith(` · ${accountName}`);
}

function extractedDocument(
  text: string,
  filename: string,
  notes: string[],
): {
  transactions: InterpretedTransaction[];
  notes: string[];
  printedAccounts?: UpPrintedBalance[];
  openingBalance?: number;
  statedBalance?: number;
  balanceSource?: "header";
} {
  const known = readBankSource({ sourceFile: filename, text });
  if (known) {
    return {
      transactions: known.transactions,
      notes,
      ...(known.printedAccounts ? { printedAccounts: known.printedAccounts } : {}),
    };
  }
  const asTable = interpretTable(rowsFromCsv(text), filename);
  const asLines = transactionsFromText(text, filename);
  const useTable = asTable.transactions.length >= asLines.length;
  const opening = printedOpeningBalance(text);
  return {
    transactions: useTable ? asTable.transactions : asLines,
    notes,
    ...(opening != null ? { openingBalance: opening } : {}),
    ...(useTable && asTable.statedBalance != null
      ? { statedBalance: asTable.statedBalance, balanceSource: "header" as const }
      : {}),
  };
}

function ofxOrg(text: string): string {
  const block = text.split(/<STMTTRN>/i)[0] ?? text;
  return ofxField(block, "ORG");
}

export async function readImageDocument(
  filename: string,
  mime: string,
  bytes: Uint8Array,
  ai?: MoneyFlowAi | null,
  ocr: (image: Uint8Array) => Promise<string> = ocrImageText,
): Promise<{ transactions: InterpretedTransaction[]; notes: string[] }> {
  const notes: string[] = [];

  if (ai && visionMime(filename, mime)) {
    try {
      const extracted = await ai.extractFromImage({ filename, mime, bytes });
      notes.push(...extracted.notes);
      if (extracted.transactions.length > 0) {
        notes.push("Read with AI vision. Check a couple of amounts before you rely on them.");
        return { transactions: extracted.transactions, notes };
      }
      notes.push("AI did not find money movement, so BitbyBit tried on-device OCR.");
    } catch (error) {
      notes.push(
        `AI could not read this photo (${error instanceof Error ? error.message : "unknown error"}). Trying on-device OCR.`,
      );
    }
  } else if (ai && !visionMime(filename, mime)) {
    notes.push("This photo format is not supported by AI vision, so BitbyBit tried on-device OCR.");
  }

  try {
    const text = (await ocr(bytes)).trim();
    if (!text) {
      return { transactions: [], notes: [...notes, "OCR did not find readable text on this image."] };
    }
    notes.push("Read with on-device OCR. Check a couple of amounts before you rely on them.");
    const extracted = extractedDocument(text, filename, notes);
    return {
      ...extracted,
      transactions: extracted.transactions.map((txn) => ({ ...txn, extractedBy: "ocr" as const })),
    };
  } catch (error) {
    return {
      transactions: [],
      notes: [...notes, `Could not OCR this image: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }
}

async function ocrImageText(bytes: Uint8Array): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const recognized = await Tesseract.recognize(Buffer.from(bytes), "eng");
  return recognized.data.text;
}

function notesForText(text: string): string[] {
  return looksLikeUpStatement(text) ? ["Read as an Up / Bendigo bank statement."] : [];
}

function parseJson(text: string, sourceFile: string): { transactions: InterpretedTransaction[]; notes: string[] } {
  const parsed: unknown = JSON.parse(text);
  const records = flattenJsonRecords(parsed);
  if (records.length === 0) return { transactions: [], notes: [] };
  const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const rows = [headers, ...records.map((record) => headers.map((header) => record[header] ?? ""))];
  return interpretTable(rows, sourceFile);
}

function flattenJsonRecords(value: unknown): Array<Record<string, string | number | null>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonRecords(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.transactions)) return flattenJsonRecords(record.transactions);
    if (Array.isArray(record.data)) return flattenJsonRecords(record.data);
    if (Array.isArray(record.rows)) return flattenJsonRecords(record.rows);
    const flattened: Record<string, string | number | null> = {};
    for (const [key, nested] of Object.entries(record)) {
      flattened[key] = nested == null || typeof nested === "object" ? JSON.stringify(nested) : (nested as string | number);
    }
    return [flattened];
  }
  return [];
}

function parseOfx(text: string, sourceFile: string): InterpretedTransaction[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  return blocks.flatMap((block, index) => {
    const amount = parseAmount(ofxField(block, "TRNAMT"));
    const posted = ofxField(block, "DTPOSTED");
    const dateIso = parseDate(posted) ?? parseDate(posted.slice(0, 8));
    const name = ofxField(block, "NAME") || ofxField(block, "MEMO") || ofxField(block, "PAYEE");
    if (amount == null || !dateIso || !name) return [];
    if (amount === 0 && isNoticeLine(`${name} ${ofxField(block, "MEMO")}`)) return [];
    const kind = ofxField(block, "TRNTYPE");
    const read = readMovement(`${name} ${kind}`, amount, true);
    return [
      {
        id: `${sourceFile}-ofx-${index}`,
        merchant: tidyMerchant(name),
        // The file's own fields for this movement. LEDGERBAL stays on the file,
        // not copied onto every row.
        ...(kind.trim() ? { bank: { type: kind.trim() } } : {}),
        source: sourceFromPairs([
          ["Type", kind],
          ["Date posted", posted],
          ["Amount", ofxField(block, "TRNAMT")],
          ["Name", ofxField(block, "NAME")],
          ["Memo", ofxField(block, "MEMO")],
          ["Reference", ofxField(block, "FITID")],
        ]),
        categoryKey: read.categoryKey,
        ...(read.tag ? { tags: [read.tag] } : {}),
        decidedBy: read.decidedBy,
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: read.amount,
        type: read.type,
        sourceFile,
        confidence: 0.95,
      } satisfies InterpretedTransaction,
    ];
  });
}

/** Statement LEDGERBAL BALAMT, not AVAILBAL. Stored once per file, including zero. */
function ofxLedgerBalance(text: string): { amount: number; asOf?: string } | null {
  const match = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([^<\n]+)/i);
  if (!match) return null;
  const amount = parseAmount(match[1].trim());
  if (amount == null) return null;
  const asOfRaw = text.match(/<LEDGERBAL>[\s\S]*?<DTASOF>\s*([^<\n]+)/i)?.[1]?.trim();
  const asOf = asOfRaw ? (parseDate(asOfRaw) ?? parseDate(asOfRaw.slice(0, 8)) ?? undefined) : undefined;
  return { amount, ...(asOf ? { asOf } : {}) };
}

function ofxField(block: string, tag: string): string {
  const xml = block.match(new RegExp(`<${tag}>([^<]+)`, "i"));
  if (xml) return xml[1].trim();
  const sgml = block.match(new RegExp(`<${tag}>([^\\n<]+)`, "i"));
  return sgml ? sgml[1].trim() : "";
}

function parseQif(text: string, sourceFile: string): InterpretedTransaction[] {
  const records = text.split("^").map((chunk) => chunk.trim()).filter(Boolean);
  return records.flatMap((record, index) => {
    const dateIso = parseDate(fieldLine(record, "D"));
    const amount = parseAmount(fieldLine(record, "T") || fieldLine(record, "U"));
    const name = fieldLine(record, "P") || fieldLine(record, "M") || fieldLine(record, "N");
    if (amount == null || !dateIso || !name) return [];
    const kind = fieldLine(record, "N");
    const category = fieldLine(record, "L");
    const read = readMovement(`${name} ${category}`, amount, true);
    const words = { ...(kind.trim() ? { type: kind.trim() } : {}), ...(category.trim() ? { category: category.trim() } : {}) };
    return [
      {
        id: `${sourceFile}-qif-${index}`,
        merchant: tidyMerchant(name),
        // QIF's L is the file's own category and its N the cheque or reference kind. Both
        // were read into the classification text and then dropped, so nothing downstream
        // could tell that this file had called a movement a transfer.
        ...(Object.keys(words).length > 0 ? { bank: words } : {}),
        source: sourceFromPairs([
          ["Date", fieldLine(record, "D")],
          ["Amount", fieldLine(record, "T") || fieldLine(record, "U")],
          ["Payee", fieldLine(record, "P")],
          ["Memo", fieldLine(record, "M")],
          ["Number", kind],
          ["Category", category],
        ]),
        categoryKey: read.categoryKey,
        ...(read.tag ? { tags: [read.tag] } : {}),
        decidedBy: read.decidedBy,
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: read.amount,
        type: read.type,
        sourceFile,
        confidence: 0.9,
      } satisfies InterpretedTransaction,
    ];
  });
}

function fieldLine(record: string, code: string): string {
  const line = record.split(/\r?\n/).find((entry) => entry.startsWith(code));
  return line ? line.slice(1).trim() : "";
}

function tablesFromHtml(html: string): string[][][] {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  return tables.map((table) => {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    return rows.map((row) => {
      const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
      return cells.map((cell) => stripTags(cell).trim());
    });
  });
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}
