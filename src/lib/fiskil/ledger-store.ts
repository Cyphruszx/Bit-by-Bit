/**
 * Server-side ledger documents for Open Banking upsert (Spec 12 Slice 3).
 *
 * Production reads and writes `public.ledgers` — the same document
 * `cloudLedgerStore` backs up and the signed-in UI rehydrates. Tests may
 * still inject an in-memory Map.
 */

import { EMPTY_LEDGER, mergeLedgers, parseLedger, type Ledger } from "@/lib/money-flow/ledger";

export type LedgerDocumentStore = {
  get(userId: string): Promise<Ledger>;
  put(userId: string, ledger: Ledger): Promise<void>;
};

/**
 * The four things a durable ledger row needs, matching the browser backup.
 *
 * read: the row, "absent" when the account reachably has none, null when we could not ask.
 * insert/update: the new revision, or null when the write touched nothing.
 */
export type LedgerDocumentRows = {
  read(userId: string): Promise<{ document: unknown; revision: number } | "absent" | null>;
  insert(userId: string, document: unknown): Promise<number | null>;
  update(userId: string, document: unknown, revision: number): Promise<number | null>;
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

/**
 * Revision-safe ledger documents: get the current backup, put merges rather
 * than replacing, so a CSV save that lands between sync get/put is kept.
 */
export function durableLedgerDocumentStore(rows: LedgerDocumentRows): LedgerDocumentStore {
  return {
    async get(userId) {
      const row = await rows.read(userId);
      if (row === null || row === "absent") return EMPTY_LEDGER;
      return parseLedger(row.document) ?? EMPTY_LEDGER;
    },
    async put(userId, ledger) {
      await writeMerged(rows, userId, ledger, false);
    },
  };
}

export function memoryLedgerDocumentRows(
  seed: Record<string, { document: unknown; revision: number }> = {},
): LedgerDocumentRows & {
  documentFor(userId: string): Ledger | undefined;
} {
  const held: Record<string, { document: unknown; revision: number }> = { ...seed };
  return {
    async read(userId) {
      return held[userId] ?? "absent";
    },
    async insert(userId, document) {
      if (held[userId]) return null;
      held[userId] = { document, revision: 1 };
      return 1;
    },
    async update(userId, document, revision) {
      const row = held[userId];
      if (!row || row.revision !== revision) return null;
      held[userId] = { document, revision: revision + 1 };
      return revision + 1;
    },
    documentFor(userId) {
      return held[userId]?.document as Ledger | undefined;
    },
  };
}

const processLedgers = memoryLedgerDocumentStore();

export function processLedgerDocumentStore(): LedgerDocumentStore {
  return processLedgers;
}

async function writeMerged(
  rows: LedgerDocumentRows,
  userId: string,
  ledger: Ledger,
  retrying: boolean,
): Promise<void> {
  const row = await rows.read(userId);
  if (row === null) {
    throw new Error("Could not reach the durable ledger store.");
  }

  const document = ledger as unknown as Record<string, unknown>;

  if (row === "absent") {
    const wrote = await rows.insert(userId, document);
    if (wrote !== null) return;
    if (retrying) throw new Error("Could not create the durable ledger row.");
    return writeMerged(rows, userId, ledger, true);
  }

  const existing = parseLedger(row.document) ?? EMPTY_LEDGER;
  const merged = mergeLedgers(ledger, existing);
  const wrote = await rows.update(userId, merged as unknown as Record<string, unknown>, row.revision);
  if (wrote !== null) return;
  if (retrying) throw new Error("Could not update the durable ledger row.");
  return writeMerged(rows, userId, ledger, true);
}
