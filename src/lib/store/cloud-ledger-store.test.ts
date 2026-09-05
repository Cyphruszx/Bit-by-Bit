import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendToLedger,
  EMPTY_LEDGER,
  nameAccount,
  type Ledger,
} from "@/lib/money-flow/ledger";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import { cloudLedgerStore, type CloudParts } from "./cloud-ledger-store";
import type { CloudRows } from "./cloud-rows";
import type { LedgerStore } from "./ledger-store";

const ME = "user-a";
const SOMEBODY_ELSE = "user-b";

let made = 0;

function txn(merchant: string, amount: number): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant,
    categoryKey: "food.restaurants",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type: amount < 0 ? "spent" : "earned",
    sourceFile: "statement.csv",
    confidence: 1,
  };
}

function file(filename: string): FileInterpretation {
  return {
    filename,
    fileType: "csv",
    kind: "csv",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    transactionCount: 0,
    notes: [],
  };
}

/** A ledger holding one statement, as if it had been uploaded on one device. */
function ledgerOf(filename: string, rows: InterpretedTransaction[], at: string): Ledger {
  return appendToLedger(
    EMPTY_LEDGER,
    { files: [file(filename)], transactions: rows.map((row) => ({ ...row, sourceFile: filename })) },
    { importedAt: at },
  ).ledger;
}

function merchants(ledger: Ledger): string[] {
  return [...new Set(ledger.entries.map((entry) => entry.merchant))].sort();
}

/** The browser's copy: what IndexedDB is in the app, without a browser. */
function localStore(start: Ledger = EMPTY_LEDGER) {
  let held = start;
  const store: LedgerStore = {
    async load() {
      return held;
    },
    async save(ledger) {
      held = ledger;
    },
    async clear() {
      held = EMPTY_LEDGER;
    },
  };
  return { store, get held() { return held; } };
}

/**
 * A database that behaves the way the real one does under the migration: one row per person,
 * a revision the server bumps on every write, and an update that touches nothing when the
 * revision it names is stale.
 */
function cloud(seed: Record<string, { document: unknown; revision: number }> = {}) {
  const rowsHeld: Record<string, { document: unknown; revision: number }> = { ...seed };
  let reachable = true;
  const calls = { insert: 0, update: 0, remove: 0 };

  const rows: CloudRows = {
    async read(userId) {
      if (!reachable) return null;
      return rowsHeld[userId] ?? "absent";
    },
    async insert(userId, document) {
      if (!reachable) return null;
      calls.insert += 1;
      if (rowsHeld[userId]) return null; // A row is already there: the primary key refuses.
      rowsHeld[userId] = { document, revision: 1 };
      return 1;
    },
    async update(userId, document, revision) {
      if (!reachable) return null;
      calls.update += 1;
      const row = rowsHeld[userId];
      if (!row || row.revision !== revision) return null;
      rowsHeld[userId] = { document, revision: revision + 1 };
      return revision + 1;
    },
    async remove(userId) {
      if (!reachable) return;
      calls.remove += 1;
      delete rowsHeld[userId];
    },
  };

  return {
    rows,
    calls,
    rowFor: (userId: string) => rowsHeld[userId],
    documentFor: (userId: string) => rowsHeld[userId]?.document as Ledger | undefined,
    unplug() {
      reachable = false;
    },
  };
}

/** Who is signed in and who the browser's copy belongs to, both changeable mid-test. */
const SETTLE_MS = 10;

function browser(signedIn: string | null, ownedBy: string | null = null) {
  const state = { signedIn, ownedBy };
  const parts = (rows: CloudRows): CloudParts => ({
    rows,
    settleMs: SETTLE_MS,
    async signedInUserId() {
      return state.signedIn;
    },
    async owner() {
      return state.ownedBy;
    },
    async setOwner(userId) {
      state.ownedBy = userId;
    },
  });
  return { state, parts };
}

describe("backing a ledger up to an account", () => {
  it("makes the first backup out of what is already in the browser", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud();
    const { parts } = browser(ME);

    const store = cloudLedgerStore(local.store, ME, parts(sky.rows));
    const loaded = await store.load();

    assert.deepEqual(merchants(loaded), ["Cafe"]);
    assert.equal(sky.rowFor(ME)?.revision, 1, "the row was made rather than waited for");
    assert.deepEqual(merchants(sky.documentFor(ME) as Ledger), ["Cafe"]);
  });

  it("adds the browser's statements to the account rather than trading them for it", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const there = ledgerOf("may.csv", [txn("Chemist", -12)], "2026-05-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud({ [ME]: { document: there, revision: 4 } });
    const { parts } = browser(ME);

    const loaded = await cloudLedgerStore(local.store, ME, parts(sky.rows)).load();

    assert.deepEqual(merchants(loaded), ["Cafe", "Chemist"], "both sides survive");
    assert.deepEqual(merchants(local.held), ["Cafe", "Chemist"], "and the browser now agrees");
    assert.deepEqual(merchants(sky.documentFor(ME) as Ledger), ["Cafe", "Chemist"]);
    assert.equal(sky.rowFor(ME)?.revision, 5, "written against the revision it was read at");
  });

  it("leaves an unchanged ledger alone instead of writing it back", async () => {
    const same = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(same);
    const sky = cloud({ [ME]: { document: same, revision: 4 } });
    const { parts } = browser(ME);

    await cloudLedgerStore(local.store, ME, parts(sky.rows)).load();

    assert.equal(sky.calls.update, 0);
    assert.equal(sky.rowFor(ME)?.revision, 4);
  });

  it("keeps both answers when another device wrote while we were deciding", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud({ [ME]: { document: here, revision: 2 } });
    const { parts } = browser(ME);

    const store = cloudLedgerStore(local.store, ME, parts(sky.rows));
    await store.load(); // learns revision 2

    // The phone names one of the accounts and gets there first.
    const phone = nameAccount(
      ledgerOf("july.csv", [txn("Chemist", -12)], "2026-07-02T00:00:00.000Z"),
      "062-000 12345678",
      "Everyday",
    );
    await sky.rows.update(ME, phone, 2);

    // Now this device sends its own change against the revision it still believes in.
    await store.save(nameAccount(here, "062-000 87654321", "Savings"));
    await settle();

    const backed = sky.documentFor(ME) as Ledger;
    assert.deepEqual(merchants(backed), ["Cafe", "Chemist"], "neither statement was lost");
    assert.deepEqual(
      Object.values(backed.accounts ?? {}).sort(),
      ["Everyday", "Savings"],
      "and neither name overwrote the other",
    );
  });

  it("still loads and still saves when the cloud cannot be reached", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud();
    sky.unplug();
    const { parts } = browser(ME);

    const store = cloudLedgerStore(local.store, ME, parts(sky.rows));
    const loaded = await store.load();
    assert.deepEqual(merchants(loaded), ["Cafe"], "a blocked host reads as an offline app");

    const more = ledgerOf("july.csv", [txn("Chemist", -12)], "2026-07-02T00:00:00.000Z");
    await store.save(more);
    assert.deepEqual(merchants(local.held), ["Chemist"], "and the browser still took it");
  });

  it("reads a corrupted row as nothing, and replaces it rather than leaving it", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud({ [ME]: { document: { entries: "not a ledger" }, revision: 9 } });
    const { parts } = browser(ME);

    const loaded = await cloudLedgerStore(local.store, ME, parts(sky.rows)).load();

    assert.deepEqual(merchants(loaded), ["Cafe"], "nothing malformed reached a total");
    assert.equal(sky.rowFor(ME)?.revision, 10, "and the unreadable row was written over");
    assert.deepEqual(merchants(sky.documentFor(ME) as Ledger), ["Cafe"]);
  });
});

describe("a browser two people have signed into", () => {
  it("does not send the last person's statements to the next person's account", async () => {
    // Somebody signed out and left their statements in the browser, as signing out is
    // meant to. The next person must not carry them into their own backup.
    const theirs = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(theirs);
    const sky = cloud();
    const { parts } = browser(SOMEBODY_ELSE, ME);

    const loaded = await cloudLedgerStore(local.store, SOMEBODY_ELSE, parts(sky.rows)).load();

    assert.deepEqual(merchants(loaded), [], "and does not show them either");
    assert.equal(sky.rowFor(SOMEBODY_ELSE), undefined, "no row was made from their money");
  });

  it("still merges up a ledger built before anybody signed in", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud();
    const { parts } = browser(ME, null);

    const loaded = await cloudLedgerStore(local.store, ME, parts(sky.rows)).load();

    assert.deepEqual(merchants(loaded), ["Cafe"], "which is what signing in promises");
    assert.deepEqual(merchants(sky.documentFor(ME) as Ledger), ["Cafe"]);
  });

  it("marks the browser's copy as ours, so signing back in merges it again", async () => {
    const local = localStore();
    const sky = cloud();
    const seen = browser(ME, null);

    const store = cloudLedgerStore(local.store, ME, seen.parts(sky.rows));
    await store.save(ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z"));

    assert.equal(seen.state.ownedBy, ME);
  });

  it("drops a save left waiting when somebody else has signed in", async () => {
    const local = localStore();
    const sky = cloud();
    const seen = browser(ME, null);

    const store = cloudLedgerStore(local.store, ME, seen.parts(sky.rows));
    await store.save(ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z"));

    // The two seconds have not passed. Somebody signs out, and somebody else signs in.
    seen.state.signedIn = SOMEBODY_ELSE;
    await settle();

    assert.equal(sky.calls.insert, 0, "nothing was sent");
    assert.equal(sky.rowFor(SOMEBODY_ELSE), undefined, "least of all to the new account");
    assert.equal(sky.rowFor(ME), undefined);
  });

  it("does not write a merge it worked out for somebody who has since signed out", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const there = ledgerOf("may.csv", [txn("Chemist", -12)], "2026-05-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud({ [ME]: { document: there, revision: 4 } });
    const seen = browser(ME, ME);

    // The account switches between reading the row and writing the merge back.
    let reads = 0;
    const rows: CloudRows = {
      ...sky.rows,
      async read(userId) {
        reads += 1;
        const row = await sky.rows.read(userId);
        if (reads === 1) seen.state.signedIn = SOMEBODY_ELSE;
        return row;
      },
    };

    await cloudLedgerStore(local.store, ME, seen.parts(rows)).load();

    assert.deepEqual(merchants(local.held), ["Cafe"], "the browser's copy was left as it was");
    assert.equal(sky.calls.update, 0, "and nothing went up under the wrong name");
  });

  it("clears both copies, and only the right person's", async () => {
    const here = ledgerOf("june.csv", [txn("Cafe", -5)], "2026-06-02T00:00:00.000Z");
    const local = localStore(here);
    const sky = cloud({
      [ME]: { document: here, revision: 3 },
      [SOMEBODY_ELSE]: { document: here, revision: 1 },
    });
    const seen = browser(ME, ME);

    await cloudLedgerStore(local.store, ME, seen.parts(sky.rows)).clear();

    assert.equal(local.held.entries.length, 0);
    assert.equal(sky.rowFor(ME), undefined);
    assert.equal(sky.rowFor(SOMEBODY_ELSE)?.revision, 1, "somebody else's backup is theirs");
    assert.equal(seen.state.ownedBy, null, "and the browser belongs to nobody again");
  });
});

/** Waits past the pause a save sits on before it is sent. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 4));
}
