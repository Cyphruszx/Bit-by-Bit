import {
  accountIdOf,
  accountKeyFrom,
  accountLabel,
  observedAccountKey,
  suggestAccountName,
  type AccountRef,
  type AccountRegistry,
} from "@/lib/money-flow/account-identity";
import { institutionOf, withInstitution } from "@/lib/money-flow/institution";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import type { InterpretedTransaction, MoneyFlowSummary } from "@/lib/money-flow/types";

const SEPARATOR = " · ";

export type AccountTotals = {
  /** Stable across statements: the same account keeps this id however it was named. */
  id: string;
  /** The account as a person would say it. */
  label: string;
  institution: string;
  /** The keys statements filed movements under, which is what naming and merging move. */
  keys: string[];
  named: boolean;
  transactions: InterpretedTransaction[];
  flow: MoneyFlowSummary;
};

/**
 * Names the bank and the account on every movement a document produced. The parser
 * supplies whichever of the two it could see — a saver's name, an account number, the
 * number printed on the letterhead — and this puts them together so two banks using
 * 100200300 never read as one account.
 */
export function identifyAccounts(
  transactions: InterpretedTransaction[],
  institution: string | undefined,
  documentRef: AccountRef = {},
): InterpretedTransaction[] {
  return withInstitution(transactions, institution).map((txn) => {
    const within = txn.accountId?.trim() || txn.accountKey?.trim();
    const key = accountKeyFrom({
      institution: institution?.trim() || institutionOf(txn),
      statement: txn.sourceFile,
      ...(within ? { name: within } : documentRef),
    });
    return { ...txn, accountId: key };
  });
}

// Identity lives with the rest of identity, so a summary can ask which account a
// movement belongs to without waiting on the totals this file computes.
export { accountIdOf, accountLabel, observedAccountKey };
export type { AccountNames, AccountRegistry } from "@/lib/money-flow/account-identity";

/** What to offer when asking the person to name an account nobody has named yet. */
export function suggestNameForKey(key: string, statement: string): string {
  const [institution, ...rest] = key.split(SEPARATOR);
  const within = rest.join(SEPARATOR);
  return suggestAccountName({
    institution,
    statement,
    ...(/^\d{5,16}$/.test(within) ? { number: within } : {}),
    ...(/^···\d{3,4}$/.test(within) ? { mask: within.slice(3) } : {}),
    ...(!/^\d{5,16}$/.test(within) && !/^···\d{3,4}$/.test(within) && within !== statement
      ? { name: within }
      : {}),
  });
}

export function accountsFrom(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): AccountTotals[] {
  const grouped = new Map<string, { rows: InterpretedTransaction[]; keys: Set<string> }>();
  for (const txn of transactions) {
    const id = accountIdOf(txn, registry);
    const held = grouped.get(id) ?? { rows: [], keys: new Set<string>() };
    held.rows.push(txn);
    held.keys.add(observedAccountKey(txn, registry.institutions ?? {}));
    grouped.set(id, held);
  }

  return [...grouped.entries()]
    .map(([id, held]) => ({
      id,
      label: accountLabel(id),
      institution: institutionOf(held.rows[0], registry.institutions ?? {}),
      keys: [...held.keys],
      named: [...held.keys].some((key) => Boolean(registry.names?.[key]?.trim())),
      transactions: held.rows,
      flow: summarizeMoneyFlow(held.rows),
    }))
    .sort(bySizeThenName);
}

export type InstitutionAccounts = {
  institution: string;
  /**
   * The bank's own money in and out, which is not the sum of its accounts': a transfer
   * between two of them cancels here and counts inside each account on its own.
   */
  flow: MoneyFlowSummary;
  accounts: AccountTotals[];
};

/** Accounts under the bank they belong to, which is how a person looks for one. */
export function accountsByInstitution(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): InstitutionAccounts[] {
  const grouped = new Map<string, AccountTotals[]>();
  for (const account of accountsFrom(transactions, registry)) {
    grouped.set(account.institution, [...(grouped.get(account.institution) ?? []), account]);
  }
  return [...grouped.entries()]
    .map(([institution, accounts]) => ({
      institution,
      flow: summarizeMoneyFlow(accounts.flatMap((account) => account.transactions)),
      accounts,
    }))
    .sort(
      (a, b) =>
        b.flow.transactionCount - a.flow.transactionCount || a.institution.localeCompare(b.institution),
    );
}

/**
 * Busiest first, and alphabetical between equals. Grouping by whichever movement happened
 * to be read first would reshuffle the accounts every time a statement arrived.
 */
function bySizeThenName(a: AccountTotals, b: AccountTotals): number {
  return b.transactions.length - a.transactions.length || a.label.localeCompare(b.label);
}
