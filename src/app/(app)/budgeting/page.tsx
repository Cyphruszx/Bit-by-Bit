import type { Metadata } from "next";
import { BudgetingView } from "./budgeting-view";

export const metadata: Metadata = {
  title: "Budgeting",
};

export default function BudgetingPage() {
  return <BudgetingView />;
}
