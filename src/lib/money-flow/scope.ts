import { accountIdOf, accountLabel, type AccountRegistry } from "@/lib/money-flow/accounts";
import { institutionOf } from "@/lib/money-flow/institution";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * What the reader is looking at: everything they hold, one bank, or one account.
 *
 * Scoping is not filtering. The totals change meaning with the scope, because a transfer
 * only cancels when both its legs are inside the scope — so choosing NAB does not subset
 * the household's figures, it produces NAB's own, which tie to NAB's statements.
 */
export type LedgerScope =
  | { kind: "all" }
  | { kind: "institution"; institution: string }
  | { kind: "account"; accountId: string };

export const EVERYTHING: LedgerScope = { kind: "all" };

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

/** Said under the totals, because a bank's own figures being larger looks wrong otherwise. */
export function describeScope(scope: LedgerScope): string {
  if (scope.kind === "all") {
    return "Every account you have uploaded, with money moved between them counted once.";
  }
  const name = scopeLabel(scope);
  return `${name} on its own. Money sent to your other accounts still counts as leaving here, so these figures tie to ${
    scope.kind === "institution" ? "the statements" : "the statement"
  } ${name} sent you.`;
}

/**
 * A scope only survives while what it names still exists: remove the statement an account
 * came from and the view falls back to everything rather than showing nothing.
 */
export function parseScope(
  value: unknown,
  known: { institutions: string[]; accounts: string[] },
): LedgerScope {
  if (!value || typeof value !== "object") return EVERYTHING;
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
  return EVERYTHING;
}
