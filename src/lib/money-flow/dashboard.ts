import {
  accountCaption,
  accountLabel,
  canonicalAccountId,
  clearedBalanceOf,
  type AccountMeta,
  type AccountRegistry,
} from "@/lib/money-flow/account-identity";
import { chartLabel } from "@/lib/money-flow/category-book";
import { needsReview } from "@/lib/money-flow/classify";
import { UNKNOWN_INSTITUTION } from "@/lib/money-flow/institution";
import { monthKey } from "@/lib/money-flow/period";
import { livePools, membersOf, type PoolBook } from "@/lib/money-flow/pools";
import { formatDisplayDate, roundMoney } from "@/lib/money-flow/parse-values";
import { countedMovements, isEarnings, isRefundCredit, isSpending, tileAmount } from "@/lib/money-flow/summary";
import {
  accountBalanceView,
  ESTIMATED_BALANCE_LABEL,
  NEGATIVE_ESTIMATE_WARNING,
  NO_OPENING_BALANCE_LABEL,
  NO_OPENING_BALANCE_PROMPT,
  type AccountBalanceView,
} from "@/lib/money-flow/statement-balance";
import { topChartCategories } from "@/lib/money-flow/tag-charts";
import { categoryOf } from "@/lib/money-flow/tags";
import type { CategorySpend, InterpretedTransaction } from "@/lib/money-flow/types";
import { accountsByInstitution, type AccountTotals, type InstitutionAccounts } from "@/lib/money-flow/accounts";

export type DashboardPoint = {
  key: string;
  label: string;
  value: number;
};

export type SpendSlice = CategorySpend & {
  label: string;
  color: string;
};

export type BudgetRow = {
  key: string;
  label: string;
  spent: number;
  target: number;
  over: number;
  percent: number;
};

export type LedgerPreviewRow = InterpretedTransaction & {
  position: number;
  account: string;
  categoryLabel: string;
  needsCategory: boolean;
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortMonthLabel(month: string): string {
  const [, monthNumber] = month.split("-").map(Number);
  return SHORT_MONTHS[(monthNumber ?? 1) - 1] ?? month;
}

export function payRunCount(transactions: InterpretedTransaction[]): number {
  return countedMovements(transactions).filter((txn) => isEarnings(txn) && categoryOf(txn) === "salary").length;
}

export function spendDonutSlices(categories: CategorySpend[], limit = 6): SpendSlice[] {
  return topChartCategories(categories, limit).map((row, index) => ({
    ...row,
    label: row.name === "Other" ? "Everything else" : chartLabel(row.name),
    color: `var(--color-chart-${(index % 8) + 1})`,
  }));
}

export const SPEND_FILL_TOKENS = [
  "bg-primary",
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
] as const;

export function spendFillToken(index: number): string {
  return SPEND_FILL_TOKENS[index % SPEND_FILL_TOKENS.length];
}

/** Scale both bars to the larger of spend vs budget so overspend still fits the track. */
export function stackedBarPercents(spent: number, target: number): { spend: number; budget: number } {
  const scale = Math.max(spent, target, 0);
  if (scale <= 0) return { spend: 0, budget: 0 };
  return {
    spend: Math.round((spent / scale) * 100),
    budget: target > 0 ? Math.round((target / scale) * 100) : 0,
  };
}

export function institutionAccountName(label: string, institution: string): string {
  const prefix = `${institution} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

export type BankAccountLine = {
  id: string;
  name: string;
  amount: number | null;
  balanceSource?: AccountBalanceView["source"];
  balanceLabel?: string;
  balancePrompt?: string;
  balanceWarning?: string;
};

export type BalanceReadout = {
  amount: number | null;
  label?: string;
  prompt?: string;
  warning?: string;
  /** Set when the sum leaves out accounts that have no opening balance. */
  excludedNote?: string;
};

export type BankInstitutionTile = {
  institution: string;
  accounts: BankAccountLine[];
};

/**
 * A stored statement balance. Without one this is null: a movement sum is not
 * shown unless `accountBalanceView` has an opening and can label it estimated.
 */
export function accountDisplayAmount(
  accountId: string,
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): number | null {
  const held = clearedBalanceOf(accountId, meta, mergedInto);
  return held.missing ? null : held.amount;
}

/**
 * Sum of the figures the Bank Accounts card shows. Accounts with no figure
 * are left out. Not Spec 10 Net.
 */
export function totalAccountBalance(tiles: BankInstitutionTile[]): number | null {
  return presentAccountTiles(tiles).amount;
}

/**
 * Household total of the card figures. Stated, statement, OFX, Fiskil, and
 * estimated balances (opening plus movements) are included. An account hidden
 * for lack of an opening balance is left out. Any estimated amount still
 * labels the total. When one or more are left out of a sum that still has a
 * figure, `excludedNote` says so. When every account lacks a figure, the
 * total is "No opening balance".
 */
export function presentAccountTiles(tiles: BankInstitutionTile[]): BalanceReadout {
  let sum = 0;
  let any = false;
  let estimated = false;
  let warning = false;
  let excluded = 0;
  for (const tile of tiles) {
    for (const account of tile.accounts) {
      if (account.amount == null) {
        if (account.balanceSource === "missing_opening") excluded += 1;
        continue;
      }
      sum = roundMoney(sum + account.amount);
      any = true;
      if (account.balanceSource === "estimated") estimated = true;
      if (account.balanceWarning) warning = true;
    }
  }
  if (!any) {
    return {
      amount: null,
      label: NO_OPENING_BALANCE_LABEL,
      prompt: NO_OPENING_BALANCE_PROMPT,
    };
  }
  const excludedNote = excludedOpeningBalanceNote(excluded);
  return {
    amount: sum,
    ...(estimated ? { label: ESTIMATED_BALANCE_LABEL } : {}),
    ...(warning ? { warning: NEGATIVE_ESTIMATE_WARNING } : {}),
    ...(excludedNote ? { excludedNote } : {}),
  };
}

/** Spec 10F. Only when the total is partial: at least one account was left out. */
export function excludedOpeningBalanceNote(count: number): string | undefined {
  if (count < 1) return undefined;
  const noun = count === 1 ? "account" : "accounts";
  return `Excludes ${count} ${noun} without an opening balance (partial).`;
}

/**
 * Bank card total. Only banks with two or more accounts show one. Any
 * estimated account labels the total; a bank whose accounts all lack a
 * figure is "No opening balance".
 */
export function bankTileTotal(tile: BankInstitutionTile): BalanceReadout | null {
  if (tile.accounts.length < 2) return null;
  return presentAccountTiles([tile]);
}

/**
 * Latest civil date among accounts that contribute a figure.
 * Pass the full ledger: a period filter does not belong here.
 * A stored `balanceAsOf` counts, and so does each included movement.
 */
export function snapshotAsOfDate(
  transactions: InterpretedTransaction[],
  tiles: BankInstitutionTile[],
  meta: Record<string, AccountMeta> = {},
  mergedInto: Record<string, string> = {},
): string | null {
  const included = new Set<string>();
  for (const tile of tiles) {
    for (const account of tile.accounts) {
      if (account.amount != null) included.add(account.id);
    }
  }
  if (included.size === 0) return null;
  let latest: string | null = null;
  const consider = (value: string | undefined) => {
    const day = value?.slice(0, 10);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    if (!latest || day > latest) latest = day;
  };
  for (const id of included) consider(meta[id]?.balanceAsOf);
  for (const txn of transactions) {
    const id = canonicalAccountId(txn.accountId?.trim() || txn.accountKey?.trim() || "", mergedInto);
    if (!included.has(id)) continue;
    consider(txn.dateIso);
  }
  return latest;
}

/** Hint under Total balance. The date is the snapshot, not the period chip. */
export function asOfHint(iso: string): string {
  return `as of ${formatDisplayDate(iso)} ${iso.slice(0, 4)}`;
}

/**
 * Transactions-page Account balance: stated balance when one is stored or
 * printed, otherwise an opening plus every signed movement. Not Spec 10 Net.
 */
export function accountBalanceOf(
  transactions: InterpretedTransaction[],
  options: {
    meta?: Record<string, AccountMeta>;
    mergedInto?: Record<string, string>;
    registry?: AccountRegistry;
    book?: PoolBook;
  } = {},
): number | null {
  return presentAccountBalance(transactions, options).amount;
}

export function presentAccountBalance(
  transactions: InterpretedTransaction[],
  options: {
    meta?: Record<string, AccountMeta>;
    mergedInto?: Record<string, string>;
    registry?: AccountRegistry;
    book?: PoolBook;
  } = {},
): BalanceReadout {
  return presentAccountTiles(
    bankInstitutionTiles(accountsByInstitution(transactions, options.registry), {
      meta: options.meta,
      mergedInto: options.mergedInto,
      book: options.book,
    }),
  );
}

/**
 * Institution tiles for the dashboard Bank Accounts card. Soft-pool members
 * stay under their bank as their own rows — balances are never merged.
 */
export function bankInstitutionTiles(
  groups: InstitutionAccounts[],
  options: {
    meta?: Record<string, AccountMeta>;
    mergedInto?: Record<string, string>;
    book?: PoolBook;
  } = {},
): BankInstitutionTile[] {
  const meta = options.meta ?? {};
  const mergedInto = options.mergedInto ?? {};
  const tiles = new Map<string, BankAccountLine[]>();
  const order = groups.map((group) => group.institution);

  const add = (institution: string, line: BankAccountLine) => {
    const held = tiles.get(institution) ?? [];
    if (held.some((row) => row.id === line.id)) return;
    tiles.set(institution, [...held, line]);
  };

  for (const group of groups) {
    for (const account of group.accounts) {
      add(group.institution, lineFromAccount(account, group.institution, meta, mergedInto));
    }
  }

  if (options.book) {
    for (const pool of livePools(options.book)) {
      for (const member of membersOf(options.book, pool.id)) {
        const id = canonicalAccountId(member.accountId, mergedInto);
        const existing = groups.find((group) => group.accounts.some((account) => account.id === id));
        const account = existing?.accounts.find((row) => row.id === id);
        const institution = existing?.institution ?? institutionFromAccountId(id);
        add(
          institution,
          lineFromView(
            id,
            account
              ? institutionAccountName(account.label, institution)
              : institutionAccountName(accountLabel(id), institution),
            accountBalanceView(id, account?.transactions ?? [], meta, mergedInto),
          ),
        );
      }
    }
  }

  return [...tiles.entries()]
    .filter(([, accounts]) => accounts.length > 0)
    .sort((left, right) => {
      const leftIndex = order.indexOf(left[0]);
      const rightIndex = order.indexOf(right[0]);
      if (leftIndex === -1 && rightIndex === -1) return left[0].localeCompare(right[0]);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([institution, accounts]) => ({ institution, accounts }));
}

function lineFromAccount(
  account: AccountTotals,
  institution: string,
  meta: Record<string, AccountMeta>,
  mergedInto: Record<string, string>,
): BankAccountLine {
  return lineFromView(
    account.id,
    institutionAccountName(account.label, institution),
    accountBalanceView(account.id, account.transactions, meta, mergedInto),
  );
}

function lineFromView(id: string, name: string, view: AccountBalanceView): BankAccountLine {
  return {
    id,
    name,
    amount: view.amount,
    balanceSource: view.source,
    ...(view.label ? { balanceLabel: view.label } : {}),
    ...(view.prompt ? { balancePrompt: view.prompt } : {}),
    ...(view.warning ? { balanceWarning: view.warning } : {}),
  };
}

function institutionFromAccountId(id: string): string {
  const [first] = id.split(" · ");
  return first?.trim() || UNKNOWN_INSTITUTION;
}

export function budgetRowsFromPrior(
  current: CategorySpend[],
  prior: CategorySpend[],
  limit = 5,
): BudgetRow[] {
  const priorBy = new Map(prior.map((row) => [row.name, row.amount]));
  return current
    .filter((row) => row.amount > 0 && row.name !== "transfers")
    .slice(0, limit)
    .map((row) => {
      const target = priorBy.get(row.name) ?? 0;
      const over = target > 0 ? Math.max(0, roundMoney(row.amount - target)) : 0;
      const percent = target > 0 ? Math.min(100, Math.round((row.amount / target) * 100)) : row.amount > 0 ? 100 : 0;
      return {
        key: row.name,
        label: chartLabel(row.name),
        spent: row.amount,
        target,
        over,
        percent,
      };
    });
}

export function monthlyNetDelta(transactions: InterpretedTransaction[], month: string): number {
  let delta = 0;
  for (const txn of countedMovements(transactions)) {
    if (monthKey(txn.dateIso) !== month) continue;
    if (isEarnings(txn)) delta += tileAmount(txn);
    else if (isSpending(txn)) delta -= Math.abs(tileAmount(txn));
    else if (isRefundCredit(txn)) delta += Math.abs(tileAmount(txn));
  }
  return roundMoney(delta);
}

export function monthlyBalanceSeries(
  transactions: InterpretedTransaction[],
  months: string[],
): DashboardPoint[] {
  const counted = countedMovements(transactions);
  const first = months[0];
  let running = 0;
  if (first) {
    for (const txn of counted) {
      const month = monthKey(txn.dateIso);
      if (!month || month >= first) continue;
      running += netOf(txn);
    }
    running = roundMoney(running);
  }

  const byMonth = new Map<string, number>();
  for (const txn of counted) {
    const month = monthKey(txn.dateIso);
    if (!months.includes(month)) continue;
    byMonth.set(month, roundMoney((byMonth.get(month) ?? 0) + netOf(txn)));
  }

  return months.map((key) => {
    running = roundMoney(running + (byMonth.get(key) ?? 0));
    return { key, label: shortMonthLabel(key), value: running };
  });
}

export function monthlySpendingSeries(
  transactions: InterpretedTransaction[],
  months: string[],
): DashboardPoint[] {
  const byMonth = new Map<string, number>();
  for (const txn of countedMovements(transactions)) {
    if (!isSpending(txn)) continue;
    const month = monthKey(txn.dateIso);
    if (!months.includes(month)) continue;
    byMonth.set(month, roundMoney((byMonth.get(month) ?? 0) + Math.abs(tileAmount(txn))));
  }
  return months.map((key) => ({
    key,
    label: shortMonthLabel(key),
    value: byMonth.get(key) ?? 0,
  }));
}

export function recentLedgerRows(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
  limit = 7,
): LedgerPreviewRow[] {
  const withPosition = withRunningPosition(transactions, registry);
  return withPosition.slice(-limit).reverse();
}

export function withRunningPosition(
  transactions: InterpretedTransaction[],
  registry: AccountRegistry = {},
): LedgerPreviewRow[] {
  const sorted = [...transactions].sort(
    (left, right) => left.dateIso.localeCompare(right.dateIso) || left.id.localeCompare(right.id),
  );
  let position = 0;
  return sorted.map((txn) => {
    position = roundMoney(position + txn.amount);
    return {
      ...txn,
      position,
      account: accountCaption(txn, registry),
      categoryLabel: chartLabel(txn.categoryKey),
      needsCategory: needsReview(txn),
    };
  });
}

function netOf(txn: InterpretedTransaction): number {
  if (isEarnings(txn)) return tileAmount(txn);
  if (isSpending(txn)) return -Math.abs(tileAmount(txn));
  if (isRefundCredit(txn)) return Math.abs(tileAmount(txn));
  return 0;
}
