import type { Metadata } from "next";
import { LinkedBalancesView } from "./linked-balances-view";

export const metadata: Metadata = {
  title: "Linked balances",
};

export default function LinkedBalancesPage() {
  return <LinkedBalancesView />;
}
