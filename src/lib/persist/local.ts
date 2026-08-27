import type { RecurringStore } from "@/lib/money-flow/recurring";
import { ALL_PERIOD, parsePeriod, type PeriodFilter } from "@/lib/money-flow/period";
import { seedSavingsPots, type SavingsPot, type SavingsSnapshot } from "@/lib/money-flow/savings";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import { INTERPRETED_KEY, PERIOD_KEY, RECURRING_KEY, SAVINGS_KEY, wipeLocalFinanceKeys } from "@/lib/persist/keys";

export type LocalInterpreted = {
  files: FileInterpretation[];
  transactions: InterpretedTransaction[];
};

export type LocalSavings = {
  pots: SavingsPot[];
  snapshots: SavingsSnapshot[];
};

const emptyInterpreted: LocalInterpreted = { files: [], transactions: [] };
const emptyRecurring: RecurringStore = { ignored: [], confirmed: [], custom: [] };

export function readLocalInterpreted(storage: Pick<Storage, "getItem"> = localStorage): LocalInterpreted {
  return parseJson(storage.getItem(INTERPRETED_KEY), (value) => ({
    files: Array.isArray(value.files) ? value.files : [],
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
  }), emptyInterpreted);
}

export function readLocalPeriod(storage: Pick<Storage, "getItem"> = localStorage): PeriodFilter {
  try {
    const raw = storage.getItem(PERIOD_KEY);
    return raw ? parsePeriod(JSON.parse(raw)) : ALL_PERIOD;
  } catch {
    return ALL_PERIOD;
  }
}

export function readLocalRecurring(storage: Pick<Storage, "getItem"> = localStorage): RecurringStore {
  return parseJson(storage.getItem(RECURRING_KEY), (value) => ({
    ignored: Array.isArray(value.ignored) ? value.ignored : [],
    confirmed: Array.isArray(value.confirmed) ? value.confirmed : [],
    custom: Array.isArray(value.custom) ? value.custom : [],
  }), emptyRecurring);
}

export function readLocalSavings(storage: Pick<Storage, "getItem"> = localStorage): LocalSavings | null {
  const raw = storage.getItem(SAVINGS_KEY);
  if (!raw) return null;
  return parseJson(raw, (value) => ({
    pots: Array.isArray(value.pots) ? value.pots : seedSavingsPots(),
    snapshots: Array.isArray(value.snapshots) ? value.snapshots : [],
  }), { pots: seedSavingsPots(), snapshots: [] });
}

export function localHasImportableData(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  const interpreted = readLocalInterpreted(storage);
  const recurring = readLocalRecurring(storage);
  const savings = readLocalSavings(storage);
  return (
    interpreted.files.length > 0 ||
    interpreted.transactions.length > 0 ||
    recurring.ignored.length > 0 ||
    recurring.confirmed.length > 0 ||
    recurring.custom.length > 0 ||
    savings != null
  );
}

export function wipeLocalFinance(storage: Pick<Storage, "removeItem"> = localStorage) {
  wipeLocalFinanceKeys(storage);
}

function parseJson<T>(
  raw: string | null,
  map: (value: Record<string, unknown>) => T,
  fallback: T,
): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    return map(parsed as Record<string, unknown>);
  } catch {
    return fallback;
  }
}
