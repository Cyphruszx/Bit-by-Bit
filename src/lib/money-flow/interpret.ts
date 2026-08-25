import { detectFileKind, toSchemaFileType } from "@/lib/money-flow/detect";
import { parseDocument } from "@/lib/money-flow/parsers";
import { summarizeMoneyFlow, uniqueTransactions } from "@/lib/money-flow/summary";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction } from "@/lib/money-flow/types";

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

export async function interpretDocuments(
  files: Array<{ filename: string; mime: string; bytes: Uint8Array }>,
): Promise<InterpretationResult> {
  const interpretations: FileInterpretation[] = [];
  const transactions: InterpretedTransaction[] = [];

  for (const file of files.slice(0, MAX_FILES)) {
    const filename = sanitizeFilename(file.filename);
    const kind = detectFileKind(filename, file.mime, file.bytes);
    const base: FileInterpretation = {
      filename,
      fileType: toSchemaFileType(kind),
      kind,
      uploadStatus: "uploaded",
      processingStatus: "processing",
      transactionCount: 0,
      notes: [],
    };

    if (file.bytes.byteLength === 0) {
      interpretations.push({
        ...base,
        uploadStatus: "failed",
        processingStatus: "failed",
        processingError: "The file was empty.",
      });
      continue;
    }
    if (file.bytes.byteLength > MAX_FILE_BYTES) {
      interpretations.push({
        ...base,
        uploadStatus: "failed",
        processingStatus: "failed",
        processingError: "Files can be up to 12MB.",
      });
      continue;
    }

    try {
      const parsed = await parseDocument(filename, file.mime, file.bytes);
      transactions.push(...parsed.transactions);
      interpretations.push({
        ...base,
        processingStatus: parsed.transactions.length > 0 ? "completed" : "failed",
        processingError:
          parsed.transactions.length > 0
            ? undefined
            : "No money movement found. Try a bank CSV, Excel, OFX, QIF, PDF statement, or a clearer photo.",
        transactionCount: parsed.transactions.length,
        notes: parsed.notes,
      });
    } catch (error) {
      interpretations.push({
        ...base,
        uploadStatus: "uploaded",
        processingStatus: "failed",
        processingError: error instanceof Error ? error.message : "Could not read this document.",
      });
    }
  }

  const merged = uniqueTransactions(transactions).sort(
    (a, b) => b.dateIso.localeCompare(a.dateIso) || b.id.localeCompare(a.id),
  );
  return { files: interpretations, transactions: merged, flow: summarizeMoneyFlow(merged) };
}

export function sanitizeFilename(filename: string): string {
  return (filename.split(/[/\\]/).pop() || "document").slice(0, 255);
}
