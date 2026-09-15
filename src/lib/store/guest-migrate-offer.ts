/**
 * Parks a Spec 4 choice until the person answers. The cloud store awaits this
 * instead of silently unioning guest and account.
 */

import type { MigrationDecision, MigrationOffer } from "@/lib/store/guest-migrate";

const listeners = new Set<() => void>();
let pending: MigrationOffer | null = null;
let resolvePending: ((decision: MigrationDecision) => void) | null = null;

export function pendingMigrationOffer(): MigrationOffer | null {
  return pending;
}

export function subscribeMigrationOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestMigrationChoice(offer: MigrationOffer): Promise<MigrationDecision> {
  pending = offer;
  listeners.forEach((listener) => listener());
  return new Promise((resolve) => {
    resolvePending = resolve;
  });
}

export function submitMigrationDecision(decision: MigrationDecision): void {
  const resolve = resolvePending;
  pending = null;
  resolvePending = null;
  listeners.forEach((listener) => listener());
  resolve?.(decision);
}

export function cancelMigrationChoice(): void {
  pending = null;
  resolvePending = null;
  listeners.forEach((listener) => listener());
}
