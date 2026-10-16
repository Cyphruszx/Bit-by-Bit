import type { Metadata } from "next";
import { BudgetingView } from "./budgeting-view";

export const metadata: Metadata = {
  title: "Budget",
};

export default function BudgetingPage() {
  return <BudgetingView />;
}
