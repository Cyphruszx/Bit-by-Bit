/**
 * Spec 3 movement_kind and authority.
 *
 * Stored ledgers still carry earned/spent/said/learned. Those names map here so a
 * backup does not break, and writers from here on use the Spec 3 names.
 *
 * Authority: a row the person settled (user_overridden) is never overwritten by a
 * merchant rule (user_rule), and neither is overwritten by Core. That keeps Spec 7
 * RESOLVE and Spec 6c merge overrides intact. New rows without an override take
 * user_rule, then Core heuristics, else UNREVIEWED.
 */

type AuthorityInput = { decidedBy?: string; userFlaggedSavings?: boolean };

export const MOVEMENT_KINDS = [
  "TRANSFER",
  "SPENDING",
  "INCOME",
  "REFUND",
  "DEBT_PRINCIPAL",
  "DEBT_COST",
  "INVESTMENT",
  "ADJUSTMENT",
  "UNREVIEWED",
] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const FROM_LEGACY: Record<string, MovementKind> = {
  earned: "INCOME",
  spent: "SPENDING",
  returned: "REFUND",
  moved: "TRANSFER",
  borrowed: "DEBT_PRINCIPAL",
  repaid: "DEBT_PRINCIPAL",
  invested: "INVESTMENT",
  adjusted: "ADJUSTMENT",
};

const KIND_SET = new Set<string>(MOVEMENT_KINDS);

export function isMovementKind(value: unknown): value is MovementKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/** Spec 3 kind for a stored or live type. Unknown falls back to UNREVIEWED. */
export function kindOf(type: string | undefined): MovementKind {
  if (!type) return "UNREVIEWED";
  if (isMovementKind(type)) return type;
  return FROM_LEGACY[type] ?? "UNREVIEWED";
}

export function migrateStoredType(value: unknown): MovementKind | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (isMovementKind(value)) return value;
  return FROM_LEGACY[value];
}

export function isTransferKind(type: string | undefined): boolean {
  return kindOf(type) === "TRANSFER";
}

export function isRefundKind(type: string | undefined): boolean {
  return kindOf(type) === "REFUND";
}

const DECIDED_ALIASES: Record<string, string> = {
  said: "user_overridden",
  learned: "user_rule",
  user_overridden: "user_overridden",
  user_rule: "user_rule",
  paired: "paired",
  merchant: "merchant",
  rules: "rules",
  bank: "bank",
  ai: "ai",
  unreviewed: "unreviewed",
};

export function migrateDecidedBy(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return DECIDED_ALIASES[value];
}

export type SpecAuthority = "user_rule" | "user_overridden" | "core" | "unreviewed";

export function authorityOf(decidedBy: string | undefined): SpecAuthority {
  const held = migrateDecidedBy(decidedBy) ?? "unreviewed";
  if (held === "user_overridden") return "user_overridden";
  if (held === "user_rule") return "user_rule";
  if (held === "unreviewed") return "unreviewed";
  return "core";
}

export function isUserOverridden(txn: AuthorityInput): boolean {
  return authorityOf(txn.decidedBy) === "user_overridden" || txn.userFlaggedSavings === true;
}

/** Core never overwrites these. */
export function isProtectedAuthority(decidedBy: string | undefined): boolean {
  const a = authorityOf(decidedBy);
  return a === "user_overridden" || a === "user_rule";
}
