/**
 * Spec 5 feature toggles, the post-CLEARED enable offer, and layout archive.
 *
 * Day-one Core is Upload / Transactions / Accounts / Dashboard money tiles.
 * After the first CLEARED row the app offers Goals, Linked balances, and Pools.
 * Cash Flow and Recurring stay off the offer (Spec 10.7). Budget waits for
 * Spec 14. OPEN_BANKING is the Spec 12 paid-bundle gate — default off, not on
 * the Core offer, entitlement billing not wired yet. Toggle-off hides UI and
 * archives the layout entry; data stays.
 */

import { isCleared } from "@/lib/money-flow/tile";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export const FEATURE_KEYS = [
  "UPLOAD",
  "TRANSACTIONS",
  "ACCOUNTS",
  "BUDGET",
  "GOALS",
  "LINKED_BALANCES",
  "POOLS",
  "CASH_FLOW",
  "RECURRING",
  "OPEN_BANKING",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_DEFAULTS: Record<FeatureKey, boolean> = {
  UPLOAD: true,
  TRANSACTIONS: true,
  ACCOUNTS: true,
  BUDGET: false,
  GOALS: false,
  LINKED_BALANCES: false,
  POOLS: false,
  CASH_FLOW: false,
  RECURRING: false,
  OPEN_BANKING: false,
};

/** Spec 5 + Spec 11. Budget is Spec 14; Cash Flow / Recurring / Open Banking stay off this list. */
export const ENABLE_OFFER_KEYS = ["GOALS", "LINKED_BALANCES", "POOLS"] as const;
export type EnableOfferKey = (typeof ENABLE_OFFER_KEYS)[number];

export const ENABLE_OFFER_LABELS: Record<EnableOfferKey, string> = {
  GOALS: "Goals",
  LINKED_BALANCES: "Linked balances",
  POOLS: "Pools",
};

export type FeatureToggles = Partial<Record<FeatureKey, boolean>>;

export type FeatureOffer = {
  shownAt?: string;
  dismissedAt?: string;
};

export type DashboardLayout = {
  archived?: Record<string, { archivedAt: string }>;
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isFeatureEnabled(toggles: FeatureToggles | undefined, key: FeatureKey): boolean {
  return toggles?.[key] ?? FEATURE_DEFAULTS[key];
}

/**
 * Spec 12.1: Open Banking ingest requires the paid Open Banking Bundle.
 * Billing entitlement is not wired yet — this is the Spec 5 hook, default off.
 */
export function hasOpenBankingBundle(toggles: FeatureToggles | undefined): boolean {
  return isFeatureEnabled(toggles, "OPEN_BANKING");
}

export function setFeatureEnabled(
  toggles: FeatureToggles | undefined,
  key: FeatureKey,
  enabled: boolean,
): FeatureToggles {
  return { ...toggles, [key]: enabled };
}

/**
 * Spec 4: apply guest OR account Core toggles. Enabled on either side stays
 * enabled. Missing keys stay missing so defaults still apply.
 */
export function mergeFeatureToggles(
  mine: FeatureToggles | undefined,
  theirs: FeatureToggles | undefined,
): FeatureToggles | undefined {
  const keys = new Set([...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})]);
  if (keys.size === 0) return undefined;
  const held: FeatureToggles = {};
  for (const key of keys) {
    if (!isFeatureKey(key)) continue;
    const a = mine?.[key];
    const b = theirs?.[key];
    if (a === true || b === true) held[key] = true;
    else if (a === false || b === false) held[key] = false;
  }
  return Object.keys(held).length > 0 ? held : undefined;
}

export function hasClearedMovement(transactions: InterpretedTransaction[]): boolean {
  return transactions.some((txn) => isCleared(txn));
}

/**
 * Show the enable offer once the ledger has a CLEARED row, unless the person
 * already dismissed it or already turned every offered feature on.
 */
export function shouldShowEnableOffer(
  toggles: FeatureToggles | undefined,
  offer: FeatureOffer | undefined,
  hasCleared: boolean,
): boolean {
  if (!hasCleared) return false;
  if (offer?.dismissedAt) return false;
  return ENABLE_OFFER_KEYS.some((key) => !isFeatureEnabled(toggles, key));
}

export function acceptEnableOffer(
  toggles: FeatureToggles | undefined,
  keys: readonly EnableOfferKey[],
  now: string,
): { toggles: FeatureToggles; offer: FeatureOffer } {
  let next = { ...toggles };
  for (const key of keys) next = setFeatureEnabled(next, key, true);
  return { toggles: next, offer: { shownAt: now, dismissedAt: now } };
}

export function dismissEnableOffer(offer: FeatureOffer | undefined, now: string): FeatureOffer {
  return { ...offer, shownAt: offer?.shownAt ?? now, dismissedAt: now };
}

export function archiveLayoutEntry(
  layout: DashboardLayout | undefined,
  key: FeatureKey,
  now: string,
): DashboardLayout {
  return {
    ...layout,
    archived: { ...layout?.archived, [key]: { archivedAt: now } },
  };
}

export function restoreLayoutEntry(
  layout: DashboardLayout | undefined,
  key: FeatureKey,
): DashboardLayout {
  if (!layout?.archived?.[key]) return layout ?? {};
  const archived = { ...layout.archived };
  delete archived[key];
  return { ...layout, archived };
}

export function isLayoutArchived(layout: DashboardLayout | undefined, key: FeatureKey): boolean {
  return Boolean(layout?.archived?.[key]);
}

export function parseFeatureToggles(raw: unknown): FeatureToggles | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const held: FeatureToggles = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isFeatureKey(key) && typeof value === "boolean") held[key] = value;
  }
  return Object.keys(held).length > 0 ? held : undefined;
}

export function parseFeatureOffer(raw: unknown): FeatureOffer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const stored = raw as Partial<FeatureOffer>;
  const offer: FeatureOffer = {};
  if (typeof stored.shownAt === "string") offer.shownAt = stored.shownAt;
  if (typeof stored.dismissedAt === "string") offer.dismissedAt = stored.dismissedAt;
  return offer.shownAt || offer.dismissedAt ? offer : undefined;
}

export function parseDashboardLayout(raw: unknown): DashboardLayout | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const stored = raw as DashboardLayout;
  if (!stored.archived || typeof stored.archived !== "object") return undefined;
  const archived: NonNullable<DashboardLayout["archived"]> = {};
  for (const [key, value] of Object.entries(stored.archived)) {
    if (!isFeatureKey(key) || !value || typeof value !== "object") continue;
    const at = (value as { archivedAt?: unknown }).archivedAt;
    if (typeof at === "string") archived[key] = { archivedAt: at };
  }
  return Object.keys(archived).length > 0 ? { archived } : undefined;
}
