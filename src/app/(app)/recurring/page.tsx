import type { Metadata } from "next";
import { RecurringView } from "./recurring-view";

export const metadata: Metadata = {
  title: "Recurring",
};

export default function RecurringPage() {
  return <RecurringView />;
}
