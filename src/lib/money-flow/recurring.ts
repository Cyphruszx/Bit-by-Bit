import { formatDisplayDate, roundMoney } from "@/lib/money-flow/parse-values";
import { tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export type Cadence = "weekly" | "fortnightly" | "monthly" | "unknown";

export type DetectedRecurring = {
  fingerprint: string;
  merchant: string;
  typicalAmount: number;
  count: number;
  cadence: Cadence;
  lastDateIso: string;
  lastDate: string;
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
