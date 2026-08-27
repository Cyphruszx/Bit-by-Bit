import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { parsePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import type { Cadence, TrackedRecurring } from "@/lib/money-flow/recurring";
import type { SavingsPot, SavingsSnapshot } from "@/lib/money-flow/savings";
import { primaryTag, subTags, tagsOf } from "@/lib/money-flow/tags";
import type {
  ExtractionSource,
  FileInterpretation,
  FileKind,
  InterpretedTransaction,
  SchemaFileType,
  TagSource,
  TransactionType,
} from "@/lib/money-flow/types";
import { redactAccountIdentifiers } from "@/lib/persist/redact";

const TYPES = new Set<TransactionType>(["income", "expense", "transfer", "refund"]);
const TAG_SOURCES = new Set<TagSource>(["rules", "ai", "user"]);
const EXTRACTORS = new Set<ExtractionSource>(["ai", "ocr", "parser"]);
const FILE_TYPES = new Set<SchemaFileType>(["csv", "xlsx", "pdf", "image", "other"]);

export type CloudFileRow = {
  id: string;
  filename: string;
  file_type: string;
  file_kind: string | null;
  notes: string[];
  transaction_count: number;
  upload_status: string;
  processing_status: string;
  processing_error: string | null;
};

export type CloudTransactionRow = {
  id: string;
  client_key: string | null;
  transaction_date: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  transaction_type: string;
  subcategory: string | null;
  source_filename: string | null;
  ai_confidence: number | null;
  tags: string[];
  tag_source: string | null;
  extracted_by: string | null;
  category_name?: string | null;
};

export type CloudRecurringRow = {
  id: string;
  fingerprint: string;
  name: string;
  amount: number;
  cadence: string;
  next_date: string | null;
  source: string;
};

export type MappedMoneyFlow = {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
};

export function fileToRow(file: FileInterpretation, userId: string) {
  const id = file.id && isUuid(file.id) ? file.id : undefined;
  return {
    ...(id ? { id } : {}),
    user_id: userId,
    filename: redactAccountIdentifiers(file.filename).slice(0, 255) || "document",
    file_type: FILE_TYPES.has(file.fileType) ? file.fileType : "other",
    file_kind: file.kind,
    notes: file.notes.map((note) => redactAccountIdentifiers(note).slice(0, 300)),
    transaction_count: file.transactionCount,
    storage_path: null,
    upload_status: file.uploadStatus,
    processing_status: file.processingStatus,
    processing_error: file.processingError ? redactAccountIdentifiers(file.processingError).slice(0, 300) : null,
  };
}

export function transactionToRow(
  txn: InterpretedTransaction,
  userId: string,
  categoryId: string | null,
  sourceFileId: string | null,
) {
  const tags = tagsOf(txn).map((tag) => redactAccountIdentifiers(tag).slice(0, 80));
  const merchant = redactAccountIdentifiers(txn.merchant).slice(0, 500) || "Unknown";
  return {
    user_id: userId,
    client_key: txn.id.slice(0, 180),
    transaction_date: txn.dateIso,
    description: merchant,
    merchant_name: merchant.slice(0, 200),
    original_description: null,
    amount: txn.amount,
    transaction_type: txn.type,
    category_id: categoryId,
    subcategory: subTags({ category: txn.category, tags })[0]?.slice(0, 80) ?? null,
    source_file_id: sourceFileId,
    source_filename: redactAccountIdentifiers(txn.sourceFile).slice(0, 255),
    ai_confidence: clampConfidence(txn.confidence),
    tags,
    tag_source: txn.tagSource ?? null,
    extracted_by: txn.extractedBy ?? null,
  };
}

export function fileFromRow(row: CloudFileRow): FileInterpretation {
  return {
    id: row.id,
    filename: row.filename,
    fileType: FILE_TYPES.has(row.file_type as SchemaFileType) ? (row.file_type as SchemaFileType) : "other",
    kind: (row.file_kind as FileKind) || "unknown",
    uploadStatus: row.upload_status === "failed" ? "failed" : "uploaded",
    processingStatus: statusFromRow(row.processing_status),
    processingError: row.processing_error ?? undefined,
    transactionCount: row.transaction_count,
    notes: row.notes ?? [],
  };
}

export function transactionFromRow(row: CloudTransactionRow): InterpretedTransaction {
  const type = TYPES.has(row.transaction_type as TransactionType)
    ? (row.transaction_type as TransactionType)
    : row.amount >= 0
      ? "income"
      : "expense";
  const tags = (row.tags ?? []).filter(Boolean);
  const category = row.category_name || tags[0] || "Other";
  return {
    id: row.client_key || row.id,
    merchant: row.merchant_name || row.description,
    category,
    tags: tags.length > 0 ? tags : [category],
    date: formatDisplayDate(row.transaction_date),
    dateIso: row.transaction_date,
    amount: Number(row.amount),
    type,
    sourceFile: row.source_filename || "account",
    confidence: row.ai_confidence ?? 1,
    tagSource: TAG_SOURCES.has(row.tag_source as TagSource) ? (row.tag_source as TagSource) : undefined,
    extractedBy: EXTRACTORS.has(row.extracted_by as ExtractionSource)
      ? (row.extracted_by as ExtractionSource)
      : undefined,
  };
}

export function periodToJson(period: PeriodFilter) {
  return period;
}

export function periodFromJson(value: unknown): PeriodFilter {
  return parsePeriod(value);
}

export function recurringToRow(item: TrackedRecurring, userId: string) {
  return {
    ...(isUuid(item.id) ? { id: item.id } : {}),
    user_id: userId,
    fingerprint: item.fingerprint.slice(0, 200),
    name: redactAccountIdentifiers(item.name).slice(0, 120) || "Payment",
    amount: item.amount,
    cadence: item.cadence,
    next_date: item.nextDate || null,
    source: item.source,
  };
}

export function recurringFromRow(row: CloudRecurringRow) {
  const cadence = (["weekly", "fortnightly", "monthly", "unknown"] as const).includes(row.cadence as Cadence)
    ? (row.cadence as Cadence)
    : "unknown";
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    name: row.name,
    amount: Number(row.amount),
    cadence,
    nextDate: row.next_date ?? "",
    source: row.source === "custom" ? ("custom" as const) : ("detected" as const),
  };
}

export function savingsPotToRow(pot: SavingsPot, userId: string, sortIndex: number) {
  return {
    ...(isUuid(pot.id) ? { id: pot.id } : {}),
    user_id: userId,
    name: pot.name.slice(0, 80) || "Pot",
    detail: pot.detail.slice(0, 200),
    saved: pot.saved,
    target: pot.target,
    monthly_contribution: pot.monthlyContribution,
    included_in_total: pot.includedInTotal !== false,
    sort_index: sortIndex,
  };
}

export function savingsPotFromRow(row: {
  id: string;
  name: string;
  detail: string;
  saved: number;
  target: number;
  monthly_contribution: number;
  included_in_total: boolean;
}): SavingsPot {
  return {
    id: row.id,
    name: row.name,
    detail: row.detail,
    saved: Number(row.saved),
    target: Number(row.target),
    monthlyContribution: Number(row.monthly_contribution),
    includedInTotal: row.included_in_total,
  };
}

export function savingsSnapshotFromRow(row: { snapshot_date: string; total_saved: number }): SavingsSnapshot {
  return { date: row.snapshot_date, totalSaved: Number(row.total_saved) };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function statusFromRow(value: string): FileInterpretation["processingStatus"] {
  if (value === "pending" || value === "processing" || value === "completed" || value === "failed") return value;
  return "completed";
}

export function neededCategoryNames(transactions: InterpretedTransaction[]): string[] {
  return [...new Set(transactions.map((txn) => primaryTag(txn)))];
}
