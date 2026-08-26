import { goals as demoGoals } from "@/lib/demo-data";

export type SavingsPot = {
  id: string;
  name: string;
  detail: string;
  saved: number;
  target: number;
  monthlyContribution: number;
};

export function seedSavingsPots(): SavingsPot[] {
  return demoGoals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    detail: goal.detail,
    saved: goal.saved,
    target: goal.target,
    monthlyContribution: goal.monthlyContribution,
  }));
}

export function monthsToPot(pot: SavingsPot): number | null {
  const remaining = pot.target - pot.saved;
  if (remaining <= 0) return 0;
  if (pot.monthlyContribution <= 0) return null;
  return Math.ceil(remaining / pot.monthlyContribution);
}
