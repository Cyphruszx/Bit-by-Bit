import { applyTagSuggestions, createOpenAiFromEnv, needsInitialTag, type MoneyFlowAi } from "@/lib/money-flow/ai";
import { detectFileKind, toSchemaFileType } from "@/lib/money-flow/detect";
import { parseDocument } from "@/lib/money-flow/parsers";
import { summarizeMoneyFlow, uniqueTransactions } from "@/lib/money-flow/summary";
import { markTransferLegs } from "@/lib/money-flow/transfers";
import type { FileInterpretation, InterpretationResult, InterpretedTransaction } from "@/lib/money-flow/types";

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

export type InterpretOptions = {
  ai?: MoneyFlowAi | null;
};

export async function interpretDocuments(
  files: Array<{ filename: string; mime: string; bytes: Uint8Array }>,
  options: InterpretOptions = {},
): Promise<InterpretationResult> {
  const ai = "ai" in options ? options.ai : createOpenAiFromEnv();
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
      const parsed = await parseDocument(filename, file.mime, file.bytes, { ai });
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

  let merged = uniqueTransactions(transactions).sort(
    (a, b) => b.dateIso.localeCompare(a.dateIso) || b.id.localeCompare(a.id),
  );
  let taggedCount = 0;

  if (ai) {
    const pending = merged.filter(needsInitialTag);
    if (pending.length > 0) {
      try {
        const suggestions = await ai.suggestTags({ transactions: pending });
        const applied = applyTagSuggestions(merged, suggestions);
        merged = applied.transactions;
        taggedCount = applied.taggedCount;
      } catch (error) {
        interpretations[0]?.notes.push(
          `AI tagging was skipped (${error instanceof Error ? error.message : "unknown error"}).`,
        );
      }
    }
  }

  // Whatever arrived together can already be paired. The ledger decides again over
  // everything it holds, because the other leg often lands in a later statement.
  merged = markTransferLegs(merged);

  const flow = summarizeMoneyFlow(merged);
  if (taggedCount > 0) {
    flow.insights.unshift(
      `AI suggested tags for ${taggedCount} unlabelled movement${taggedCount === 1 ? "" : "s"}. You can change them on Transactions.`,
    );
  }

  return { files: interpretations, transactions: merged, flow };
}

export function sanitizeFilename(filename: string): string {
  return (filename.split(/[/\\]/).pop() || "document").slice(0, 255);
}
