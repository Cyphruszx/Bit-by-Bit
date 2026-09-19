/**
 * Server-side ledger documents for Open Banking upsert (Spec 12 Slice 3).
 *
 * Slice 1/2 stores are process memory; this matches that pattern so webhook
 * and poll jobs share the same document the sync tests inject.
 */

import { EMPTY_LEDGER, type Ledger } from "@/lib/money-flow/ledger";

export type LedgerDocumentStore = {
  get(userId: string): Promise<Ledger>;
  put(userId: string, ledger: Ledger): Promise<void>;
};

export function memoryLedgerDocumentStore(): LedgerDocumentStore {
  const byUser = new Map<string, Ledger>();
  return {
    async get(userId) {
      return structuredClone(byUser.get(userId) ?? EMPTY_LEDGER);
    },
    async put(userId, ledger) {
      byUser.set(userId, structuredClone(ledger));
    },
  };
}

const processLedgers = memoryLedgerDocumentStore();

export function processLedgerDocumentStore(): LedgerDocumentStore {
  return processLedgers;
}
