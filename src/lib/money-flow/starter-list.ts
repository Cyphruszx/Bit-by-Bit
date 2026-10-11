/**
 * Amend BV Rev 3.1 starter list.
 *
 * The named table is 13 groups. The spec's "27 categories" line adds that table up
 * wrong (the same line's own sum is 29). The categories below are every name in the
 * table, which is 29. The old→new map is kept and not applied (BV.T.3).
 *
 * `PRELAUNCH_STARTER_RESET` is the launch switch. Set it to false before public
 * launch so the reset prompt never shows (BV.T.2).
 */

/** Bump when the default groups and categories change. Version 1 is the previous list. */
export const STARTER_LIST_VERSION = 2;

/** Pre-launch only. False locks the reset prompt off. */
export const PRELAUNCH_STARTER_RESET = true;

/**
 * Old filing key → new filing key. Not applied to stored rows.
 * Shopping splits into Clothing and Household & electronics; this map does not choose
 * Clothing, so it is not run.
 */
export const STARTER_CATEGORY_MIGRATION: Record<string, string> = {
  shopping: "household-electronics",
};

export type StarterLedgerShape = {
  starterListVersion?: number;
  imports: readonly unknown[];
  entries: readonly unknown[];
  taxonomy?: unknown;
  verdicts?: object;
  rules?: object;
  payers?: object;
  review?: readonly unknown[];
};

function hasKeys(value: object | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

/** Statements, marks, rules, or a saved category list — anything the reset would clear. */
export function ledgerHasTestData(ledger: StarterLedgerShape): boolean {
  return (
    ledger.imports.length > 0 ||
    ledger.entries.length > 0 ||
    Boolean(ledger.taxonomy) ||
    hasKeys(ledger.verdicts) ||
    hasKeys(ledger.rules) ||
    hasKeys(ledger.payers) ||
    (ledger.review?.length ?? 0) > 0
  );
}

/**
 * Missing version plus saved test data is the previous starter list.
 * An empty ledger is already on the current list.
 */
export function starterListVersionOf(ledger: StarterLedgerShape): number {
  if (typeof ledger.starterListVersion === "number") return ledger.starterListVersion;
  return ledgerHasTestData(ledger) ? 1 : STARTER_LIST_VERSION;
}

/**
 * True when the stored list is older and the pre-launch prompt is still switched on.
 * Pass `enabled` only in tests; production uses {@link PRELAUNCH_STARTER_RESET}.
 */
export function needsStarterReset(
  ledger: StarterLedgerShape,
  enabled = PRELAUNCH_STARTER_RESET,
): boolean {
  if (!enabled) return false;
  return starterListVersionOf(ledger) < STARTER_LIST_VERSION;
}
