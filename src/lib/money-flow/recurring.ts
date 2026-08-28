import { formatDisplayDate, roundMoney } from "@/lib/money-flow/parse-values";
import { inPeriod, monthBounds, type PeriodFilter } from "@/lib/money-flow/period";
import { tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type Cadence = "weekly" | "fortnightly" | "monthly" | "unknown";

export type TrackedRecurring = {
  id: string;
  fingerprint: string;
  name: string;
  amount: number;
  cadence: Cadence;
  nextDate: string;
  source: "detected" | "custom";
};

export type RecurringStore = {
  ignored: string[];
  confirmed: TrackedRecurring[];
  custom: TrackedRecurring[];
};

export type DetectedRecurring = {
  fingerprint: string;
  merchant: string;
  typicalAmount: number;
  count: number;
  cadence: Cadence;
  lastDateIso: string;
  lastDate: string;
  dates: string[];
  suggested: boolean;
};

const BILL_HINT =
  /\b(netflix|spotify|disney|stan|prime|rent|landlord|insurance|gym|adobe|google one|google play|apple\.com|opal|subscription|membership|rate|strata|mortgage)\b/i;

export function recurringFingerprint(merchant: string, amount: number): string {
  return `${merchant.trim().toLowerCase()}|${Math.round(Math.abs(amount))}`;
}

export function detectRecurringOutflows(transactions: InterpretedTransaction[]): DetectedRecurring[] {
  const groups = new Map<string, InterpretedTransaction[]>();
  for (const txn of transactions) {
    if (txn.amount >= 0 || txn.type === "transfer") continue;
    const key = recurringFingerprint(txn.merchant, txn.amount);
    const list = groups.get(key) ?? [];
    list.push(txn);
    groups.set(key, list);
  }

  const results: DetectedRecurring[] = [];
  for (const rows of groups.values()) {
    const looksLikeBill = rows.some((txn) => BILL_HINT.test(`${txn.merchant} ${tagsOf(txn).join(" ")}`));
    if (rows.length < 2 && !looksLikeBill) continue;
    const amounts = rows.map((txn) => Math.abs(txn.amount)).sort((a, b) => a - b);
    const typicalAmount = roundMoney(amounts[Math.floor(amounts.length / 2)]);
    const dates = rows.map((txn) => txn.dateIso).filter(Boolean).sort();
    const lastDateIso = dates[dates.length - 1] ?? "";
    results.push({
      fingerprint: recurringFingerprint(rows[0].merchant, typicalAmount),
      merchant: rows[0].merchant,
      typicalAmount,
      count: rows.length,
      cadence: inferCadence(dates, rows.length === 1),
        lastDateIso,
        lastDate: lastDateIso ? formatDisplayDate(lastDateIso) : rows[0].date,
        dates,
        suggested: rows.length < 2,
    });
  }

  return results.sort((a, b) => b.typicalAmount - a.typicalAmount || a.merchant.localeCompare(b.merchant));
}

export function cadenceLabel(cadence: Cadence): string {
  if (cadence === "weekly") return "Weekly";
  if (cadence === "fortnightly") return "Fortnightly";
  if (cadence === "monthly") return "Monthly";
  return "Not sure";
}

export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  if (cadence === "weekly") return roundMoney((amount * 52) / 12);
  if (cadence === "fortnightly") return roundMoney((amount * 26) / 12);
  return roundMoney(amount);
}

export function addCadence(iso: string, cadence: Cadence): string {
  return shiftCadence(iso, cadence, 1);
}

export function subtractCadence(iso: string, cadence: Cadence): string {
  return shiftCadence(iso, cadence, -1);
}

function shiftCadence(iso: string, cadence: Cadence, direction: 1 | -1): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (cadence === "weekly") date.setUTCDate(date.getUTCDate() + 7 * direction);
  else if (cadence === "fortnightly") date.setUTCDate(date.getUTCDate() + 14 * direction);
  else date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

export function nextDateFromLast(lastDateIso: string, cadence: Cadence, todayIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDateIso)) return todayIso;
  if (lastDateIso >= todayIso) return lastDateIso;
  let current = lastDateIso;
  for (let i = 0; i < 48 && current < todayIso; i += 1) {
    current = addCadence(current, cadence);
  }
  return current;
}

export function advanceAfterPaid(nextDate: string, cadence: Cadence, todayIso: string): string {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? nextDate : todayIso;
  let current = addCadence(start, cadence);
  for (let i = 0; i < 48 && current < todayIso; i += 1) {
    current = addCadence(current, cadence);
  }
  return current;
}

export type TrackablePayment = {
  fingerprint: string;
  name: string;
  amount: number;
  cadence: Cadence;
  nextDate: string;
};

export type TrackingStatus = "paid" | "due" | "overdue" | "upcoming";

export type TrackingSnapshot = {
  status: TrackingStatus;
  expectedDate: string | null;
  matchedDate: string | null;
};

export function paymentMatches(item: Pick<TrackablePayment, "fingerprint" | "name" | "amount">, txn: InterpretedTransaction): boolean {
  if (txn.amount >= 0 || txn.type === "transfer") return false;
  const txnKey = recurringFingerprint(txn.merchant, txn.amount);
  return item.fingerprint === txnKey || recurringFingerprint(item.name, item.amount) === txnKey;
}

export function periodDateBounds(period: PeriodFilter): { from: string; to: string } | null {
  if (period.kind === "all") return null;
  if (period.kind === "month") return monthBounds(period.month);
  const from = period.from <= period.to ? period.from : period.to;
  const to = period.from <= period.to ? period.to : period.from;
  return { from, to };
}

export function expectedOccurrence(
  nextDate: string,
  cadence: Cadence,
  from: string,
  to: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return null;
  let latest: string | null = null;
  let current = nextDate;
  for (let i = 0; i < 48; i += 1) {
    if (current < from) break;
    if (current <= to) latest = current;
    current = subtractCadence(current, cadence);
  }
  current = addCadence(nextDate, cadence);
  for (let i = 0; i < 48; i += 1) {
    if (current > to) break;
    if (current >= from) latest = !latest || current > latest ? current : latest;
    current = addCadence(current, cadence);
  }
  return latest;
}

export function trackedInPeriod(
  item: TrackablePayment,
  period: PeriodFilter,
  transactions: InterpretedTransaction[],
): boolean {
  if (period.kind === "all") return true;
  if (item.nextDate && inPeriod(item.nextDate, period)) return true;
  if (transactions.some((txn) => paymentMatches(item, txn) && inPeriod(txn.dateIso, period))) return true;
  const bounds = periodDateBounds(period);
  if (item.nextDate && bounds && item.nextDate < bounds.from) {
    const paidSinceDue = transactions.some((txn) => paymentMatches(item, txn) && txn.dateIso >= item.nextDate);
    if (!paidSinceDue) return true;
  }
  return false;
}

export function trackingSnapshot(
  item: TrackablePayment,
  transactions: InterpretedTransaction[],
  period: PeriodFilter,
  todayIso: string,
): TrackingSnapshot {
  const matches = transactions.filter((txn) => paymentMatches(item, txn)).sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  const bounds = periodDateBounds(period);
  const inScope = (date: string) => (bounds ? date >= bounds.from && date <= bounds.to : true);
  const latestInScope = [...matches].reverse().find((txn) => inScope(txn.dateIso)) ?? null;
  const expected = bounds
    ? expectedOccurrence(item.nextDate, item.cadence, bounds.from, bounds.to)
    : item.nextDate || null;
  const dueDate = expected ?? (item.nextDate || null);

  if (bounds && latestInScope) {
    return { status: "paid", expectedDate: dueDate, matchedDate: latestInScope.dateIso };
  }

  if (!bounds) {
    const latest = matches[matches.length - 1] ?? null;
    if (dueDate && dueDate > todayIso) {
      return { status: "upcoming", expectedDate: dueDate, matchedDate: latest?.dateIso ?? null };
    }
    if (dueDate && dueDate === todayIso) {
      return { status: "due", expectedDate: dueDate, matchedDate: latest?.dateIso ?? null };
    }
    if (dueDate && dueDate < todayIso) {
      const paidThisCycle = latest && latest.dateIso >= dueDate;
      if (paidThisCycle) return { status: "paid", expectedDate: dueDate, matchedDate: latest.dateIso };
      return { status: "overdue", expectedDate: dueDate, matchedDate: latest?.dateIso ?? null };
    }
    if (latest) return { status: "paid", expectedDate: dueDate, matchedDate: latest.dateIso };
    return { status: "upcoming", expectedDate: dueDate, matchedDate: null };
  }

  if (dueDate && dueDate < todayIso) return { status: "overdue", expectedDate: dueDate, matchedDate: null };
  if (dueDate && dueDate === todayIso) return { status: "due", expectedDate: dueDate, matchedDate: null };
  return { status: "upcoming", expectedDate: dueDate, matchedDate: null };
}

export function statusLabel(status: TrackingStatus): string {
  if (status === "paid") return "Paid";
  if (status === "due") return "Due today";
  if (status === "overdue") return "Overdue";
  return "Upcoming";
}

function inferCadence(dateIso: string[], singleHit: boolean): Cadence {
  if (singleHit) return "monthly";
  if (dateIso.length < 2) return "unknown";
  const gaps: number[] = [];
  for (let i = 1; i < dateIso.length; i += 1) {
    const days = (Date.parse(`${dateIso[i]}T00:00:00Z`) - Date.parse(`${dateIso[i - 1]}T00:00:00Z`)) / 86400000;
    if (days > 0) gaps.push(days);
  }
  if (gaps.length === 0) return "unknown";
  const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median >= 5 && median <= 9) return "weekly";
  if (median >= 12 && median <= 18) return "fortnightly";
  if (median >= 25 && median <= 36) return "monthly";
  return "unknown";
}
