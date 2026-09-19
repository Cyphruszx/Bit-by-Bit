import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_LEDGER, fingerprintOf, mergeLedgers, type Ledger, type LedgerEntry } from "@/lib/money-flow/ledger";
import {
  durableLedgerDocumentStore,
  memoryLedgerDocumentRows,
  processLedgerDocumentStore,
} from "./ledger-store";
import {
  connectionFromRow,
  connectionToRow,
  memoryOpenBankingStores,
  processOpenBankingStores,
  resolveOpenBankingStores,
  usesDurableOpenBankingStores,
} from "./runtime-stores";
import { memoryConnectionStore } from "./connections";

function csvEntry(): LedgerEntry {
  const incoming = {
    id: "csv-1",
    merchant: "Cafe",
    categoryKey: "eating_out",
    date: "1 Sep 2026",
    dateIso: "2026-09-01",
    amount: -6,
    baseAmount: -6,
    status: "CLEARED" as const,
    type: "SPENDING" as const,
    sourceFile: "nab.csv",
    confidence: 1,
    accountId: "NAB · 100200300",
    institution: "NAB",
    description: "Cafe",
  };
  return {
    ...incoming,
    fingerprint: fingerprintOf(incoming),
    importIds: ["csv-import"],
    firstSeen: "2026-09-01T00:00:00.000Z",
  };
}

describe("Open Banking production store path", () => {
  it("uses durable stores when the service role is configured, not process memory", () => {
    assert.equal(
      usesDurableOpenBankingStores({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }),
      true,
    );
    assert.equal(usesDurableOpenBankingStores({}), false);

    const memory = processOpenBankingStores();
    const durable = memoryOpenBankingStores();
    const production = resolveOpenBankingStores({
      adminConfigured: true,
      durable,
      memory,
    });
    assert.equal(production.ledgers, durable.ledgers);
    assert.equal(production.connections, durable.connections);
    assert.notEqual(production.ledgers, processLedgerDocumentStore());
    assert.notEqual(production.connections, memory.connections);
  });

  it("falls back to the process singletons only when admin is not configured", () => {
    const memory = processOpenBankingStores();
    const durable = memoryOpenBankingStores();
    const local = resolveOpenBankingStores({ adminConfigured: false, durable, memory });
    assert.equal(local.ledgers, processLedgerDocumentStore());
    assert.equal(local.connections, memory.connections);
  });
});

describe("durable ledger document store", () => {
  it("writes the same public.ledgers document shape the UI rehydrates, and merges CSV", async () => {
    const csv: Ledger = { ...EMPTY_LEDGER, entries: [csvEntry()] };
    const rows = memoryLedgerDocumentRows({
      "user-1": { document: csv, revision: 3 },
    });
    const ledgers = durableLedgerDocumentStore(rows);
    const held = await ledgers.get("user-1");
    assert.equal(held.entries[0]?.id, "csv-1");

    const incoming: Ledger = {
      ...EMPTY_LEDGER,
      entries: [
        {
          id: "ob:tx_1",
          merchant: "Woolworths",
          categoryKey: "groceries",
          date: "10 Sep 2026",
          dateIso: "2026-09-10",
          amount: -12.5,
          baseAmount: -12.5,
          status: "CLEARED",
          type: "SPENDING",
          sourceFile: "open-banking://consent_1/acc_1",
          confidence: 1,
          accountId: "NAB · 100200300",
          institution: "NAB",
          description: "Woolworths",
          externalId: "tx_1",
          ingestSource: "OPEN_BANKING",
          fingerprint: "ob-fp",
          importIds: ["ob-import"],
          firstSeen: "2026-09-19T12:00:00.000Z",
        },
      ],
      accounts: { "NAB · 100200300": "Everyday" },
    };
    await ledgers.put("user-1", incoming);

    const stored = rows.documentFor("user-1");
    assert.ok(stored);
    const merchants = stored.entries.map((row) => row.merchant).sort();
    assert.deepEqual(merchants, ["Cafe", "Woolworths"]);
    assert.equal(
      stored.entries.some((row) => row.id === "csv-1"),
      true,
    );
    assert.equal(mergeLedgers(csv, stored).entries.length, 2);
  });
});

describe("connection row mapping", () => {
  it("round-trips a connection through the durable row shape", async () => {
    const store = memoryConnectionStore();
    const row = {
      id: "consent_1",
      userId: "11111111-1111-1111-1111-111111111111",
      endUserId: "eu_1",
      sessionId: "sess_1",
      consentId: "consent_1",
      status: "active" as const,
      createdAt: "2026-09-19T00:00:00.000Z",
      lastSyncedAt: "2026-09-19T12:00:00.000Z",
      lastCursor: "2026-09-19T12:00:00.000Z",
      firstSyncCompletedAt: "2026-09-19T12:00:00.000Z",
    };
    await store.put(row);
    assert.deepEqual(connectionFromRow(connectionToRow(row)), {
      ...row,
    });
  });
});
