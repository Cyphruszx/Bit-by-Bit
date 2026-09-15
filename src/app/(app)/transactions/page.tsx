import type { Metadata } from "next";
import { TransactionsView } from "./transactions-view";

export const metadata: Metadata = {
  title: "Transactions",
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ dev?: string | string[] }>;
}) {
  const params = (await searchParams) ?? {};
  const raw = params.dev;
  return <TransactionsView devQuery={Array.isArray(raw) ? raw[0] : raw} />;
}
