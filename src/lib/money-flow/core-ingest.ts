/**
 * Spec 2 Core ingest gates.
 *
 * CSV + digital PDF + OCR. Spec 2 weekly caps are 5 CSV / 20 OCR pages per
 * Australia/Sydney week. Those caps are off for unrestricted testing:
 * tryChargeCsv / tryChargeOcr still record usage but never refuse.
 * Text-extract PDF uses a CSV Confirm slot. OCR pages debit only when OCR runs
 * (photos at intake; scanned PDF pages after interpret). CSV slot only on Confirm.
 *
 * Re-enable weekly caps later by setting NEXT_PUBLIC_INGEST_QUOTAS_DISABLED=false
 * (the upload studio charges in the browser, so it must be NEXT_PUBLIC_) or by
 * flipping INGEST_QUOTAS_DISABLED_DEFAULT to false. Soft file-size guidance is
 * separate from these weekly blocks.
 */

import { knownInstitutions } from "@/lib/money-flow/institution";
import { APP_TIME_ZONE, calendarDate } from "@/lib/money-flow/period";
import {
  mappedPreviewRows,
  MAPPED_PREVIEW_LIMIT,
  type MappedPreviewRow,
} from "@/lib/money-flow/tabular";
import type { FileKind, InterpretationResult, InterpretedTransaction } from "@/lib/money-flow/types";

export { MAPPED_PREVIEW_LIMIT as CONFIRM_PREVIEW_LIMIT };
export type { MappedPreviewRow };

export const CSV_WEEKLY_LIMIT = 5;
export const OCR_PAGE_WEEKLY_LIMIT = 20;
export const CORE_FILES_PER_ATTEMPT = 1;

/**
 * Default for unset env. true = testing, charges always succeed.
 * Flip to false (or set NEXT_PUBLIC_INGEST_QUOTAS_DISABLED=false) to restore caps.
 */
export const INGEST_QUOTAS_DISABLED_DEFAULT = true;

export type IngestChannel = "csv" | "ocr";

export type QuotaUsage = {
  week: string;
  csv: number;
  ocrPages: number;
};

function bundledQuotaEnv(): Record<string, string | undefined> {
  return {
    // Direct static reads so Next.js inlines the public flag in the client bundle.
    NEXT_PUBLIC_INGEST_QUOTAS_DISABLED: process.env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED,
    INGEST_QUOTAS_DISABLED: process.env.INGEST_QUOTAS_DISABLED,
  };
}

/** Weekly CSV/OCR caps are off unless env (or the default) says otherwise. */
export function ingestQuotasDisabled(
  env: Record<string, string | undefined> = bundledQuotaEnv(),
): boolean {
  const raw = env.NEXT_PUBLIC_INGEST_QUOTAS_DISABLED ?? env.INGEST_QUOTAS_DISABLED;
  if (raw === undefined || raw.trim() === "") return INGEST_QUOTAS_DISABLED_DEFAULT;
  const value = raw.trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off" || value === "no") return false;
  if (value === "true" || value === "1" || value === "on" || value === "yes") return true;
  return INGEST_QUOTAS_DISABLED_DEFAULT;
}

export function quotaStatusLabel(usage: QuotaUsage): string {
  if (ingestQuotasDisabled()) return "Testing — quotas off";
  const csvLeft = Math.max(0, CSV_WEEKLY_LIMIT - usage.csv);
  const ocrLeft = Math.max(0, OCR_PAGE_WEEKLY_LIMIT - usage.ocrPages);
  return `${csvLeft} CSV and ${ocrLeft} OCR pages left this AU week`;
}

export const LAUNCH_BANK_PRESETS = knownInstitutions();

const DEVICE_KEY = "bitbybit.device-id";
const QUOTA_KEY = "bitbybit.quota-v1";

const CORE_CHANNELS = new Set(["csv", "ocr"]);

export type QuotaActor = {
  userId?: string | null;
  deviceId?: string | null;
};

export type QuotaStore = {
  read(subject: string): QuotaUsage | undefined;
  write(subject: string, usage: QuotaUsage): void;
};

export type AccountSection = {
  accountId: string;
  assignedTo: string;
};

export type IngestDraft = {
  result: InterpretationResult;
  hashes?: Record<string, string>;
  channel: IngestChannel;
  ocrPages: number;
  institution: string;
  detectedInstitution?: string;
  sections: AccountSection[];
};

export type UploadRowStatus = "CLEARED" | "DUPLICATE_HOLD";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "short" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ingestChannel(kind: FileKind | undefined): IngestChannel | undefined {
  if (kind === "csv" || kind === "text" || kind === "pdf") return "csv";
  if (kind === "image") return "ocr";
  return undefined;
}

export function draftChannel(kind: FileKind | undefined, ocrPages: number): IngestChannel {
  if (ocrPages > 0) return "ocr";
  return ingestChannel(kind) ?? "csv";
}

export function coreIngestUnavailable(kind: FileKind): string | undefined {
  if (CORE_CHANNELS.has(ingestChannel(kind) ?? "")) return undefined;
  return "Core accepts CSV, digital PDF, and photos (OCR) only. Excel, OFX, and QIF are unavailable.";
}

export function ocrPagesFor(kind: FileKind | undefined, pageCount?: number): number {
  if (kind === "pdf") return pageCount && pageCount > 0 ? pageCount : 0;
  if (ingestChannel(kind) !== "ocr") return 0;
  return pageCount && pageCount > 0 ? pageCount : 1;
}

/** Photos charge 1 OCR page before interpret. PDF waits until the path is known. */
export function intakeOcrPages(kind: FileKind | undefined): number {
  return kind === "image" ? 1 : 0;
}

export function ocrPagesToChargeAfterInterpret(ocrPages: number, alreadyCharged: number): number {
  return Math.max(0, ocrPages - alreadyCharged);
}

export function isLaunchPreset(label: string | undefined): boolean {
  const name = label?.trim();
  if (!name) return false;
  return LAUNCH_BANK_PRESETS.some((preset) => preset.toLowerCase() === name.toLowerCase());
}

export function needsManualMap(institution: string | undefined): boolean {
  return !isLaunchPreset(institution);
}

export function auWeekKey(at: Date = new Date()): string {
  const civil = calendarDate(at.toISOString());
  const weekday = WEEKDAY.format(sydneyNoon(civil));
  const offset = (WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]) + 6) % 7;
  return addCivilDays(civil, -offset);
}

export function quotaSubject(actor: QuotaActor): string {
  if (actor.userId?.trim()) return `user:${actor.userId.trim()}`;
  if (actor.deviceId?.trim()) return `guest:${actor.deviceId.trim()}`;
  throw new Error("Quota needs a signed-in user or a guest device id.");
}

export function emptyQuota(week: string): QuotaUsage {
  return { week, csv: 0, ocrPages: 0 };
}

export function memoryQuotaStore(seed: Record<string, QuotaUsage> = {}): QuotaStore {
  const held = { ...seed };
  return {
    read: (subject) => held[subject],
    write: (subject, usage) => {
      held[subject] = usage;
    },
  };
}

export function localQuotaStore(): QuotaStore {
  return {
    read(subject) {
      const all = readQuotaBlob();
      return all[subject];
    },
    write(subject, usage) {
      const all = readQuotaBlob();
      all[subject] = usage;
      localStorage.setItem(QUOTA_KEY, JSON.stringify(all));
    },
  };
}

export function guestDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY)?.trim();
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export function peekQuota(store: QuotaStore, subject: string, at: Date = new Date()): QuotaUsage {
  const week = auWeekKey(at);
  const held = store.read(subject);
  if (!held || held.week !== week) return emptyQuota(week);
  return held;
}

export function canChargeCsv(usage: QuotaUsage, slots = 1): boolean {
  return usage.csv + slots <= CSV_WEEKLY_LIMIT;
}

export function canChargeOcr(usage: QuotaUsage, pages: number): boolean {
  return usage.ocrPages + pages <= OCR_PAGE_WEEKLY_LIMIT;
}

export function tryChargeCsv(
  store: QuotaStore,
  subject: string,
  at: Date = new Date(),
): { ok: true; usage: QuotaUsage } | { ok: false; usage: QuotaUsage } {
  const current = peekQuota(store, subject, at);
  if (!ingestQuotasDisabled() && !canChargeCsv(current)) return { ok: false, usage: current };
  const usage = { ...current, csv: current.csv + 1 };
  store.write(subject, usage);
  return { ok: true, usage };
}

export function tryChargeOcr(
  store: QuotaStore,
  subject: string,
  pages: number,
  at: Date = new Date(),
): { ok: true; usage: QuotaUsage } | { ok: false; usage: QuotaUsage } {
  const charged = Math.max(0, pages);
  const current = peekQuota(store, subject, at);
  if (charged === 0) return { ok: true, usage: current };
  if (!ingestQuotasDisabled() && !canChargeOcr(current, charged)) return { ok: false, usage: current };
  const usage = { ...current, ocrPages: current.ocrPages + charged };
  store.write(subject, usage);
  return { ok: true, usage };
}

export function createDraft(
  result: InterpretationResult,
  hashes?: Record<string, string>,
): IngestDraft {
  const kind = result.files[0]?.kind;
  const ocrPages = result.files.reduce((sum, file) => sum + ocrPagesFor(file.kind, file.ocrPages), 0);
  const channel = draftChannel(kind, ocrPages);
  const ids = unique(result.transactions.map((txn) => txn.accountId?.trim()).filter(Boolean) as string[]);
  const detected = result.transactions.find((txn) => txn.institution?.trim())?.institution?.trim();
  const single = ids.length <= 1;
  return {
    result,
    hashes,
    channel,
    ocrPages,
    institution: isLaunchPreset(detected) ? (detected ?? "") : "",
    detectedInstitution: detected,
    sections: ids.map((accountId) => ({ accountId, assignedTo: single ? accountId : "" })),
  };
}

export function canConfirmDraft(draft: IngestDraft): boolean {
  if (draft.result.transactions.length === 0) return false;
  if (draft.result.files.some((file) => file.processingError)) return false;
  if (needsManualMap(draft.detectedInstitution) && !draft.institution.trim()) return false;
  if (draft.sections.length > 1 && draft.sections.some((section) => !section.assignedTo.trim())) return false;
  return true;
}

export function detectedBankLabel(draft: IngestDraft): string {
  return draft.detectedInstitution?.trim() || "Unknown";
}

export type ConfirmIssue = {
  severity: "block" | "warn";
  message: string;
};

/** Blocking issues and parse notes for the Confirm step. Empty drafts cannot be confirmed. */
export function confirmDraftIssues(draft: IngestDraft): ConfirmIssue[] {
  const issues: ConfirmIssue[] = [];
  const error = draft.result.files.find((file) => file.processingError)?.processingError;
  if (error) issues.push({ severity: "block", message: error });
  if (draft.result.transactions.length === 0) {
    issues.push({ severity: "block", message: "0 movements — nothing will import." });
  }
  if (needsManualMap(draft.detectedInstitution) && !draft.institution.trim()) {
    issues.push({
      severity: "block",
      message:
        "Bank was not recognised as a launch-bank template. Discard this file — unknown files are a later fail path, not a mapper.",
    });
  }
  if (draft.sections.length > 1 && draft.sections.some((section) => !section.assignedTo.trim())) {
    issues.push({ severity: "block", message: "Assign every account before import." });
  }
  for (const note of draft.result.files.flatMap((file) => file.notes)) {
    issues.push({ severity: "warn", message: note });
  }
  return issues;
}

/** Preview of mapped draft movements that Confirm will commit. Not a remapper. */
export function confirmPreviewRows(draft: IngestDraft, limit = MAPPED_PREVIEW_LIMIT): MappedPreviewRow[] {
  const assigned = new Map(draft.sections.map((section) => [section.accountId, section.assignedTo.trim()]));
  return mappedPreviewRows(draft.result.transactions, {
    limit,
    showAccount: draft.sections.length > 1,
    accountLabel: (txn) => {
      if (!txn.accountId) return undefined;
      return assigned.get(txn.accountId) || txn.accountId;
    },
  });
}

export function applyDraft(draft: IngestDraft): InterpretationResult {
  const institution = draft.institution.trim();
  const assigned = new Map(draft.sections.map((section) => [section.accountId, section.assignedTo.trim()]));
  const transactions = draft.result.transactions.map((txn) => {
    const target = txn.accountId ? assigned.get(txn.accountId) : "";
    const next: InterpretedTransaction = {
      ...txn,
      status: persistUploadStatus(txn.status),
    };
    if (institution) next.institution = institution;
    if (target && target !== txn.accountId) next.accountId = target;
    return next;
  });
  return { ...draft.result, transactions };
}

/** Upload-derived status is CLEARED or DUPLICATE_HOLD. PENDING is never written. */
export function persistUploadStatus(
  status: InterpretedTransaction["status"] | "PENDING" | undefined,
): "CLEARED" | "HOLD" | "DUPLICATE_HOLD" {
  if (status === "DUPLICATE_HOLD" || status === "HOLD") return status;
  return "CLEARED";
}

export function uploadStatus(duplicate: boolean): UploadRowStatus {
  return duplicate ? "DUPLICATE_HOLD" : "CLEARED";
}

function sydneyNoon(civil: string): Date {
  return new Date(`${civil}T02:00:00.000Z`);
}

function addCivilDays(civil: string, days: number): string {
  const [year, month, day] = civil.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function readQuotaBlob(): Record<string, QuotaUsage> {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, QuotaUsage>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
