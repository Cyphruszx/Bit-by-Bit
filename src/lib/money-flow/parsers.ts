import { type MoneyFlowAi, visionMime } from "@/lib/money-flow/ai";
import { categorize, inferType, tidyMerchant } from "@/lib/money-flow/categorize";
import { detectFileKind } from "@/lib/money-flow/detect";
import { identifyAccounts } from "@/lib/money-flow/accounts";
import { detectInstitution, type InstitutionSignals } from "@/lib/money-flow/institution";
import { decodeText, formatDisplayDate, parseAmount, parseDate } from "@/lib/money-flow/parse-values";
import { interpretTable, rowsFromCsv, transactionsFromTable } from "@/lib/money-flow/tabular";
import { looksLikeUpStatement, transactionsFromUpStatement } from "@/lib/money-flow/up-statement";
import { transactionsFromText } from "@/lib/money-flow/text-lines";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type ParseDocumentOptions = {
  ai?: MoneyFlowAi | null;
};

export async function parseDocument(
  filename: string,
  mime: string,
  bytes: Uint8Array,
  options: ParseDocumentOptions = {},
): Promise<{ transactions: InterpretedTransaction[]; notes: string[] }> {
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
    return stamped({ transactions: parseOfx(text, filename), notes }, { org: ofxOrg(text), filename });
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
      return stamped(
        { transactions: tableTransactions, notes: fromTables.flatMap((result) => result.notes) },
        { text: html, headers: fromTables.flatMap((result) => result.headers), filename },
      );
    }
    return stamped(
      { transactions: transactionsFromExtractedText(stripTags(html), filename), notes: notesForText(html) },
      { text: html, filename },
    );
  }
  if (kind === "text") {
    const text = decodeText(bytes);
    return stamped(
      { transactions: transactionsFromExtractedText(text, filename), notes: notesForText(text) },
      { text, filename },
    );
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
    const transactions = sheets.flatMap((sheet) => sheet.transactions);
    const sheetNotes = sheets.flatMap((sheet) => sheet.notes);
    if (workbook.SheetNames.length > 1) sheetNotes.unshift(`Read ${workbook.SheetNames.length} sheets`);
    return { transactions, notes: sheetNotes };
  }
  if (kind === "pdf") {
    const { extractText } = await import("unpdf");
    const extracted = await extractText(bytes, { mergePages: true });
    const text = extracted.text.trim();
    if (!text) {
      notes.push("This PDF looks scanned. BitbyBit will try OCR next if you upload a photo of the page.");
      return { transactions: [], notes };
    }
    return stamped({ transactions: transactionsFromExtractedText(text, filename), notes: notesForText(text) }, { text, filename });
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return stamped(
      { transactions: transactionsFromExtractedText(result.value, filename), notes: notesForText(result.value) },
      { text: result.value, filename },
    );
  }
  if (kind === "image") {
    return stamped(await readImageDocument(filename, mime, bytes, options.ai), { filename });
  }

  const fallback = decodeText(bytes);
  return stamped(
    { transactions: transactionsFromExtractedText(fallback, filename), notes: notesForText(fallback) },
    { text: fallback, filename },
  );
}

/** Names the bank once per document, from whatever that document happened to reveal. */
function stamped(
  result: { transactions: InterpretedTransaction[]; notes: string[] },
  signals: InstitutionSignals,
): { transactions: InterpretedTransaction[]; notes: string[] } {
  return {
    transactions: identifyAccounts(result.transactions, detectInstitution(signals)),
    notes: result.notes,
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
    return {
      transactions: transactionsFromExtractedText(text, filename).map((txn) => ({ ...txn, extractedBy: "ocr" as const })),
      notes,
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

function transactionsFromExtractedText(text: string, filename: string): InterpretedTransaction[] {
  if (looksLikeUpStatement(text)) return transactionsFromUpStatement(text, filename);
  const asTable = transactionsFromTable(rowsFromCsv(text), filename);
  const asLines = transactionsFromText(text, filename);
  return asTable.length >= asLines.length ? asTable : asLines;
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
    const category = categorize(name);
    const type = inferType(`${name} ${ofxField(block, "TRNTYPE")}`, amount, category);
    return [
      {
        id: `${sourceFile}-ofx-${index}`,
        merchant: tidyMerchant(name),
        category,
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: type === "income" || type === "refund" ? Math.abs(amount) : amount,
        type,
        sourceFile,
        confidence: 0.95,
      } satisfies InterpretedTransaction,
    ];
  });
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
    const category = categorize(`${name} ${fieldLine(record, "L")}`);
    const type = inferType(name, amount, category);
    return [
      {
        id: `${sourceFile}-qif-${index}`,
        merchant: tidyMerchant(name),
        category,
        date: formatDisplayDate(dateIso),
        dateIso,
        amount: type === "income" || type === "refund" ? Math.abs(amount) : amount,
        type,
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
