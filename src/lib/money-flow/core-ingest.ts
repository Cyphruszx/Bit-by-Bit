/**
 * Spec 2 Core ingest gates.
 *
 * CSV + OCR only. 5 CSV / 20 OCR pages per Australia/Sydney week.
 * OCR pages debit at intake (failures included). CSV slot only on Confirm.
 */

import { knownInstitutions } from "@/lib/money-flow/institution";
import { APP_TIME_ZONE, calendarDate } from "@/lib/money-flow/period";
import type { FileKind, InterpretationResult, InterpretedTransaction } from "@/lib/money-flow/types";

export const CSV_WEEKLY_LIMIT = 5;
export const OCR_PAGE_WEEKLY_LIMIT = 20;
export const CORE_FILES_PER_ATTEMPT = 1;

export const LAUNCH_BANK_PRESETS = knownInstitutions();

const DEVICE_KEY = "bitbybit.device-id";
const QUOTA_KEY = "bitbybit.quota-v1";

const CORE_CHANNELS = new Set(["csv", "ocr"]);

export type IngestChannel = "csv" | "ocr";

export type QuotaUsage = {
  week: string;
  csv: number;
  ocrPages: number;
  /** Spec 4: a guest quota that has already been migrated cannot charge again. */
  sealed?: boolean;
  migratedFromGuestId?: string;
  migrationStatus?: "done";
};

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
  if (kind === "csv" || kind === "text") return "csv";
  if (kind === "image") return "ocr";
  return undefined;
}

export function coreIngestUnavailable(kind: FileKind): string | undefined {
  if (CORE_CHANNELS.has(ingestChannel(kind) ?? "")) return undefined;
  if (kind === "pdf") {
    return "Core reads photos with OCR. Digital PDF is unavailable — photograph each page.";
  }
  return "Core accepts CSV and photos (OCR) only. Excel, OFX, and QIF are unavailable.";
}

export function ocrPagesFor(kind: FileKind | undefined, pageCount?: number): number {
  if (ingestChannel(kind) !== "ocr") return 0;
  return pageCount && pageCount > 0 ? pageCount : 1;
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
  if (!held) return emptyQuota(week);
  if (held.week !== week) {
    return {
      ...emptyQuota(week),
      ...quotaMigrationFields(held),
    };
  }
  return held;
}

/** Spec 4: carry seal / migrated-from across an AU week rollover. */
function quotaMigrationFields(held: QuotaUsage): Partial<QuotaUsage> {
  return {
    ...(held.sealed ? { sealed: true } : {}),
    ...(held.migratedFromGuestId ? { migratedFromGuestId: held.migratedFromGuestId } : {}),
    ...(held.migrationStatus ? { migrationStatus: held.migrationStatus } : {}),
  };
}

export function canChargeCsv(usage: QuotaUsage, slots = 1): boolean {
  return usage.csv + slots <= CSV_WEEKLY_LIMIT;
}

export function canChargeOcr(usage: QuotaUsage, pages: number): boolean {
  return usage.ocrPages + pages <= OCR_PAGE_WEEKLY_LIMIT;
}

/**
 * Spec 4: user week becomes max(guest, user). Guest is sealed. Idempotent on
 * the same guest_id.
 */
export function migrateQuotas(
  store: QuotaStore,
  guestId: string,
  userId: string,
  at: Date = new Date(),
): QuotaUsage {
  const guestSubject = quotaSubject({ deviceId: guestId });
  const userSubject = quotaSubject({ userId });
  const user = peekQuota(store, userSubject, at);
  if (user.migrationStatus === "done" && user.migratedFromGuestId === guestId) return user;

  const guest = peekQuota(store, guestSubject, at);
  const week = auWeekKey(at);
  const merged: QuotaUsage = {
    week,
    csv: Math.max(guest.csv, user.csv),
    ocrPages: Math.max(guest.ocrPages, user.ocrPages),
    migratedFromGuestId: guestId,
    migrationStatus: "done",
  };
  store.write(userSubject, merged);
  store.write(guestSubject, { ...guest, week: guest.week || week, sealed: true });
  return merged;
}

export function tryChargeCsv(
  store: QuotaStore,
  subject: string,
  at: Date = new Date(),
): { ok: true; usage: QuotaUsage } | { ok: false; usage: QuotaUsage } {
  const current = peekQuota(store, subject, at);
  if (current.sealed || !canChargeCsv(current)) return { ok: false, usage: current };
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
  if (current.sealed || !canChargeOcr(current, charged)) return { ok: false, usage: current };
  const usage = { ...current, ocrPages: current.ocrPages + charged };
  store.write(subject, usage);
  return { ok: true, usage };
}

export function createDraft(
  result: InterpretationResult,
  hashes?: Record<string, string>,
): IngestDraft {
  const kind = result.files[0]?.kind;
  const channel = ingestChannel(kind) ?? "csv";
  const ids = unique(result.transactions.map((txn) => txn.accountId?.trim()).filter(Boolean) as string[]);
  const detected = result.transactions.find((txn) => txn.institution?.trim())?.institution?.trim();
  const single = ids.length <= 1;
  return {
    result,
    hashes,
    channel,
    ocrPages: result.files.reduce((sum, file) => sum + ocrPagesFor(file.kind, file.ocrPages), 0),
    institution: isLaunchPreset(detected) ? (detected ?? "") : "",
    detectedInstitution: detected,
    sections: ids.map((accountId) => ({ accountId, assignedTo: single ? accountId : "" })),
  };
}

export function canConfirmDraft(draft: IngestDraft): boolean {
  if (needsManualMap(draft.detectedInstitution) && !draft.institution.trim()) return false;
  if (draft.sections.length > 1 && draft.sections.some((section) => !section.assignedTo.trim())) return false;
  return true;
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
