"use client";

import { useMoneyFlow } from "@/components/money-flow-provider";
import { PeriodPicker } from "@/components/period-picker";
import { anchorMonth, monthsForPicker, sydneyMonthKey } from "@/lib/money-flow/period-picker";

export function PeriodFilterBar() {
  const { allTransactions, period, setPeriod } = useMoneyFlow();
  const todayMonth = sydneyMonthKey();
  const months = monthsForPicker(
    allTransactions.map((txn) => txn.dateIso),
    period,
    todayMonth,
  );
  const anchor = anchorMonth(period, months, todayMonth);

  return <PeriodPicker months={months} period={period} onPeriod={setPeriod} anchor={anchor} />;
}
