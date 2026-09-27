import { accountIdOf, accountLabel, type AccountRegistry } from "@/lib/money-flow/accounts";
import { institutionOf } from "@/lib/money-flow/institution";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * What the reader is looking at: one bank, or one account inside it.
 *
 * Transactions has no Everything option. Money in and money out on a bank
 * already omit classified internal transfers, including a one-legged TRANSFER.
 */
export type LedgerScope =
  | { kind: "all" }
  | { kind: "institution"; institution: string }
  | { kind: "account"; accountId: string };

export const EVERYTHING: LedgerScope = { kind: "all" };

/**
 * Transactions opens on the first bank in dashboard card order.
 * `institutions` must already be that order: movement count descending, then name.
 * An empty ledger keeps the internal all-scope; the bar is not shown then.
 */
export function defaultTransactionScope(institutions: readonly string[]): LedgerScope {
  const first = institutions[0];
  if (!first) return EVERYTHING;
  return { kind: "institution", institution: first };
}

/** Bank chips on Transactions, in the order given. Everything is not one of them. */
export function transactionBankLabels(groups: ReadonlyArray<{ institution: string }>): string[] {
  return groups.map((group) => group.institution);
}

export function filterByScope(
  transactions: InterpretedTransaction[],
  scope: LedgerScope,
  registry: AccountRegistry = {},
): InterpretedTransaction[] {
  if (scope.kind === "all") return transactions;
  if (scope.kind === "institution") {
    return transactions.filter(
      (txn) => institutionOf(txn, registry.institutions ?? {}) === scope.institution,
    );
  }
  return transactions.filter((txn) => accountIdOf(txn, registry) === scope.accountId);
}

export function scopeLabel(scope: LedgerScope): string {
  if (scope.kind === "all") return "Everything";
  if (scope.kind === "institution") return scope.institution;
  return accountLabel(scope.accountId);
}

/** Said under the totals, so a bank's own money in and out are not read as the household's. */
export function describeScope(scope: LedgerScope): string {
  if (scope.kind === "all") {
    return "Every account you have uploaded. Money in and out leave out internal transfers.";
  }
  const name = scopeLabel(scope);
  return `${name} on its own. Money in and out leave out internal transfers.`;
}

/**
 * A scope only survives while what it names still exists: remove the statement an account
 * came from and the view falls back to everything rather than showing nothing.
 */
export function parseScope(
  value: unknown,
  known: { institutions: string[]; accounts: string[] },
): LedgerScope {
  const fallback = defaultTransactionScope(known.institutions);
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (
    record.kind === "institution" &&
    typeof record.institution === "string" &&
    known.institutions.includes(record.institution)
  ) {
    return { kind: "institution", institution: record.institution };
  }
  if (
    record.kind === "account" &&
    typeof record.accountId === "string" &&
    known.accounts.includes(record.accountId)
  ) {
    return { kind: "account", accountId: record.accountId };
  }
  return fallback;
}
