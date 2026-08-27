export const INTERPRETED_KEY = "bitbybit.interpreted-v1";
export const PERIOD_KEY = "bitbybit.period-v1";
export const RECURRING_KEY = "bitbybit.recurring-v1";
export const SAVINGS_KEY = "bitbybit.savings-v1";

export const LOCAL_FINANCE_KEYS = [INTERPRETED_KEY, PERIOD_KEY, RECURRING_KEY, SAVINGS_KEY] as const;

export function wipeLocalFinanceKeys(storage: Pick<Storage, "removeItem"> = localStorage) {
  for (const key of LOCAL_FINANCE_KEYS) storage.removeItem(key);
}
