/**
 * Spec 11 Soft pools / Pools.
 *
 * Membership is undoable and never a merge. Cash in pool is cash CLEARED Σ only.
 * Spec 4 guest migrate remaps member account_ids.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountMeta } from "./account-identity";
import {
  ENABLE_OFFER_KEYS,
  acceptEnableOffer,
  archiveLayoutEntry,
  dismissEnableOffer,
  isFeatureEnabled,
  isLayoutArchived,
  mergeFeatureToggles,
  restoreLayoutEntry,
  setFeatureEnabled,
  shouldShowEnableOffer,
} from "./features";
import {
  addPoolMember,
  applyMergedIntoToPoolMembers,
  archivePool,
  cashInPool,
  createPool,
  EMPTY_POOL_BOOK,
  hasMultiPoolOverlap,
  livePools,
  memberSignedBalance,
  migrateGuestPools,
  POOL_SOFT_LIMIT,
  remapPoolMemberAccountIds,
  removePoolMember,
  renamePool,
  type PoolBook,
  type PoolWriteResult,
} from "./pools";
import {
  appendToLedger,
  EMPTY_LEDGER,
  fingerprintOf,
  ledgerTransactions,
  mergeAccounts,
  mergeLedgers,
  parseLedger,
  type Ledger,
} from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import type { FileInterpretation, InterpretedTransaction } from "./types";

const NOW = "2026-09-15T00:00:00.000Z";
const EVERYDAY = "Up · Everyday";
const SAVER = "Up · Savings";
const VISA = "Up · Visa credit";
const USD = "Wise · USD checking";

const META: Record<string, AccountMeta> = {
  [EVERYDAY]: { kind: "CHECKING", currency: "AUD", clearedBalance: 800 },
  [SAVER]: { kind: "SAVINGS", currency: "AUD", clearedBalance: 400 },
  [VISA]: { kind: "CREDIT", currency: "AUD", clearedBalance: -420 },
  [USD]: { kind: "CHECKING", currency: "USD", clearedBalance: 50 },
};

function bookWith(name = "Holiday"): { book: PoolBook; poolId: string } {
  return { book: mustOk(createPool(EMPTY_POOL_BOOK, { id: "pool-1", userId: "guest", name, now: NOW })).book, poolId: "pool-1" };
}

function mustOk(result: PoolWriteResult): Extract<PoolWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: over.id ?? "a",
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? "groceries",
    date: over.date ?? "15 May",
    dateIso: over.dateIso ?? "2026-05-15",
    amount: over.amount ?? -10,
    type: over.type ?? "spent",
    sourceFile: over.sourceFile ?? "statement.csv",
    confidence: 1,
    status: "CLEARED",
    ...over,
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

describe("pool membership", () => {
  it("enforces unique (pool_id, account_id)", () => {
    const { book, poolId } = bookWith();
    const first = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW }));
    const again = addPoolMember(first.book, poolId, EVERYDAY, { meta: META, now: NOW });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.match(again.reason, /already/);
    assert.equal(first.book.members.length, 1);
  });

  it("lets one account sit in more than one pool", () => {
    const holiday = bookWith("Holiday");
    const bills = mustOk(createPool(holiday.book, { id: "pool-2", userId: "guest", name: "Bills", now: NOW }));
    const inHoliday = mustOk(addPoolMember(bills.book, holiday.poolId, EVERYDAY, { meta: META, now: NOW }));
    const inBills = mustOk(addPoolMember(inHoliday.book, "pool-2", EVERYDAY, { meta: META, now: NOW }));
    assert.equal(inBills.book.members.length, 2);
    assert.equal(hasMultiPoolOverlap(inBills.book), true);
  });

  it("allows an empty pool and archives instead of deleting", () => {
    const { book, poolId } = bookWith();
    assert.equal(livePools(book).length, 1);
    assert.equal(book.members.length, 0);
    const archived = mustOk(archivePool(book, poolId, NOW));
    assert.equal(livePools(archived.book).length, 0);
    assert.equal(archived.book.pools[0]?.deletedAt, NOW);
  });

  it("undoes membership by removing the member row", () => {
    const { book, poolId } = bookWith();
    const added = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW }));
    const removed = mustOk(removePoolMember(added.book, poolId, EVERYDAY));
    assert.equal(removed.book.members.length, 0);
    assert.equal(removed.book.pools[0]?.id, poolId);
  });

  it("blocks a currency mismatch on add", () => {
    const { book, poolId } = bookWith();
    const aud = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW }));
    const usd = addPoolMember(aud.book, poolId, USD, { meta: META, now: NOW });
    assert.equal(usd.ok, false);
    if (usd.ok) return;
    assert.match(usd.reason, /USD/);
    assert.equal(aud.book.members.length, 1);
  });

  it("files a merged source under the survivor and never keeps both", () => {
    const { book, poolId } = bookWith();
    const mergedInto = { "Up · ···000": EVERYDAY };
    const added = mustOk(addPoolMember(book, poolId, "Up · ···000", { meta: META, mergedInto, now: NOW }));
    assert.equal(added.book.members[0]?.accountId, EVERYDAY);
    const again = addPoolMember(added.book, poolId, EVERYDAY, { meta: META, mergedInto, now: NOW });
    assert.equal(again.ok, false);
  });

  it("warns softly at 20 or more live pools", () => {
    let book = EMPTY_POOL_BOOK;
    for (let i = 0; i < POOL_SOFT_LIMIT - 1; i += 1) {
      const next = mustOk(createPool(book, { id: `p${i}`, userId: "guest", name: `Pool ${i}`, now: NOW }));
      book = next.book;
      assert.equal(next.softWarning, undefined);
    }
    const twentieth = mustOk(createPool(book, { id: "p19", userId: "guest", name: "Pool 19", now: NOW }));
    assert.match(twentieth.softWarning ?? "", /20/);
  });

  it("renames a live pool and refuses a blank name", () => {
    const { book, poolId } = bookWith();
    const renamed = mustOk(renamePool(book, poolId, "Trip", NOW));
    assert.equal(renamed.book.pools[0]?.name, "Trip");
    const blank = renamePool(book, poolId, "   ");
    assert.equal(blank.ok, false);
  });
});

describe("Cash in pool", () => {
  it("sums CHECKING/SAVINGS cleared_balance and excludes debt", () => {
    const { book, poolId } = bookWith();
    let next = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW })).book;
    next = mustOk(addPoolMember(next, poolId, SAVER, { meta: META, now: NOW })).book;
    next = mustOk(addPoolMember(next, poolId, VISA, { meta: META, now: NOW })).book;

    const cash = cashInPool(next, poolId, META);
    assert.equal(cash.amount, 1200);
    assert.equal(cash.cashMemberCount, 2);
    assert.equal(cash.missingBalances, false);
    assert.equal(memberSignedBalance(VISA, META).amount, -420);
  });

  it("hides Cash in pool when there are no cash members", () => {
    const { book, poolId } = bookWith();
    const debtOnly = mustOk(addPoolMember(book, poolId, VISA, { meta: META, now: NOW }));
    const cash = cashInPool(debtOnly.book, poolId, META);
    assert.equal(cash.amount, null);
    assert.equal(cash.cashMemberCount, 0);
  });

  it("may go negative when Everyday is negative", () => {
    const { book, poolId } = bookWith();
    const meta = { ...META, [EVERYDAY]: { ...META[EVERYDAY], clearedBalance: -50 } };
    const added = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta, now: NOW }));
    assert.equal(cashInPool(added.book, poolId, meta).amount, -50);
  });

  it("treats a missing cleared_balance as 0 with a soft hint and does not invent Σ movements", () => {
    const { book, poolId } = bookWith();
    const meta: Record<string, AccountMeta> = { [EVERYDAY]: { kind: "CHECKING", currency: "AUD" } };
    const added = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta, now: NOW }));
    const cash = cashInPool(added.book, poolId, meta);
    assert.equal(cash.amount, 0);
    assert.equal(cash.missingBalances, true);
    assert.equal(memberSignedBalance(EVERYDAY, meta).missing, true);
  });

  it("does not use movement totals when a stored cleared_balance is present", () => {
    const { book, poolId } = bookWith();
    const added = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW }));
    const ledger = appendToLedger(
      EMPTY_LEDGER,
      {
        files: [file("up.csv")],
        transactions: [
          txn({ id: "a", accountId: EVERYDAY, amount: 999, type: "earned" }),
          txn({ id: "b", accountId: EVERYDAY, amount: -100 }),
        ],
      },
      { importedAt: NOW },
    ).ledger;
    const before = summarizeMoneyFlow(ledgerTransactions(ledger));
    const withPool: Ledger = {
      ...ledger,
      accountPools: added.book.pools,
      accountPoolMembers: added.book.members,
      accountMeta: META,
    };
    assert.equal(cashInPool(added.book, poolId, META).amount, 800);
    assert.notEqual(before.cashNet, 800);
    assert.equal(summarizeMoneyFlow(ledgerTransactions(withPool)).income, before.income);
    assert.equal(summarizeMoneyFlow(ledgerTransactions(withPool)).spending, before.spending);
    assert.equal(summarizeMoneyFlow(ledgerTransactions(withPool)).actualSavings, before.actualSavings);
  });
});

describe("Spec 4 migrate remaps pool member account_ids", () => {
  it("rewrites guest account_ids onto the registered survivor", () => {
    const guestPool = mustOk(createPool(EMPTY_POOL_BOOK, { id: "pool-g", userId: "guest", name: "Holiday", now: NOW }));
    const guest = mustOk(addPoolMember(guestPool.book, "pool-g", "guest-everyday", {
      meta: { "guest-everyday": { kind: "CHECKING", currency: "AUD", clearedBalance: 10 } },
      now: NOW,
    }));

    const migrated = migrateGuestPools(guest.book, EMPTY_POOL_BOOK, { "guest-everyday": "acct-1" }, {
      "acct-1": EVERYDAY,
    });

    assert.equal(migrated.pools[0]?.id, "pool-g");
    assert.equal(migrated.members[0]?.accountId, EVERYDAY);
    assert.equal(migrated.members.length, 1);
  });

  it("merges guest and registered books and collapses duplicate members", () => {
    const guestMade = mustOk(createPool(EMPTY_POOL_BOOK, { id: "shared", userId: "guest", name: "Guest name", now: NOW }));
    const guest = mustOk(addPoolMember(guestMade.book, "shared", EVERYDAY, { meta: META, now: NOW }));
    const mineMade = mustOk(createPool(EMPTY_POOL_BOOK, { id: "shared", userId: "user", name: "Mine", now: NOW }));
    const mine = mustOk(addPoolMember(mineMade.book, "shared", EVERYDAY, { meta: META, now: NOW }));

    const merged = migrateGuestPools(guest.book, mine.book, {});
    assert.equal(merged.pools.length, 1);
    assert.equal(merged.pools[0]?.name, "Mine");
    assert.equal(merged.members.length, 1);
  });

  it("remapPoolMemberAccountIds is unique on (pool_id, account_id)", () => {
    const book: PoolBook = {
      pools: [],
      members: [
        { poolId: "p", accountId: "a", addedAt: "2026-01-01T00:00:00.000Z" },
        { poolId: "p", accountId: "b", addedAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    const remapped = remapPoolMemberAccountIds(book, { a: "c", b: "c" });
    assert.equal(remapped.members.length, 1);
    assert.equal(remapped.members[0]?.accountId, "c");
    assert.equal(remapped.members[0]?.addedAt, "2026-01-01T00:00:00.000Z");
  });
});

describe("ledger copy/merge keeps pools and does not rewrite fingerprints", () => {
  it("round-trips account_pools through parseLedger, including Spec column names", () => {
    const { book, poolId } = bookWith();
    const added = mustOk(addPoolMember(book, poolId, EVERYDAY, { meta: META, now: NOW }));
    const ledger: Ledger = {
      ...EMPTY_LEDGER,
      accountPools: added.book.pools,
      accountPoolMembers: added.book.members,
    };
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));
    assert.deepEqual(restored?.accountPools, added.book.pools);
    assert.deepEqual(restored?.accountPoolMembers, added.book.members);

    const snake = parseLedger({
      version: 1,
      entries: [],
      imports: [],
      accountPools: [
        {
          id: "pool-s",
          user_id: "guest",
          name: "Snake",
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      accountPoolMembers: [{ pool_id: "pool-s", account_id: EVERYDAY, added_at: NOW }],
    });
    assert.equal(snake?.accountPools?.[0]?.name, "Snake");
    assert.equal(snake?.accountPoolMembers?.[0]?.accountId, EVERYDAY);
  });

  it("mergeLedgers copies guest pools and remaps members through merged_into", () => {
    const guestMade = mustOk(createPool(EMPTY_POOL_BOOK, { id: "pool-g", userId: "guest", name: "Holiday", now: NOW }));
    const guest = mustOk(addPoolMember(guestMade.book, "pool-g", "Up · ···000", {
      meta: { "Up · ···000": { kind: "CHECKING", currency: "AUD", clearedBalance: 5 } },
      now: NOW,
    }));
    const guestLedger: Ledger = {
      ...EMPTY_LEDGER,
      accountPools: guest.book.pools,
      accountPoolMembers: guest.book.members,
      mergedInto: { "Up · ···000": EVERYDAY },
    };
    const cloud: Ledger = { ...EMPTY_LEDGER, mergedInto: { "Up · ···000": EVERYDAY } };
    const merged = mergeLedgers(guestLedger, cloud);
    assert.equal(merged.accountPools?.[0]?.name, "Holiday");
    assert.equal(merged.accountPoolMembers?.[0]?.accountId, EVERYDAY);
  });

  it("pool writes do not touch merged_into or fingerprints", () => {
    const held = appendToLedger(
      EMPTY_LEDGER,
      { files: [file("up.csv")], transactions: [txn({ id: "keep", accountId: EVERYDAY })] },
      { importedAt: NOW },
    ).ledger;
    const beforePrints = held.entries.map((entry) => entry.fingerprint);
    const beforeMerged = held.mergedInto;

    const created = mustOk(createPool(EMPTY_POOL_BOOK, { id: "pool-1", userId: "guest", name: "Holiday", now: NOW }));
    const withMember = mustOk(addPoolMember(created.book, "pool-1", EVERYDAY, { meta: META, now: NOW }));
    const ledger: Ledger = {
      ...held,
      accountPools: withMember.book.pools,
      accountPoolMembers: withMember.book.members,
    };

    assert.deepEqual(ledger.entries.map((entry) => entry.fingerprint), beforePrints);
    assert.equal(ledger.mergedInto, beforeMerged);
    assert.equal(
      ledger.entries[0]?.fingerprint,
      fingerprintOf({ ...ledger.entries[0]!, accountId: EVERYDAY }, 0, ledger.mergedInto),
    );
  });

  it("a hard merge remaps pool members onto the survivor without pool code writing merged_into itself", () => {
    const source = "Up · ···000";
    const held = appendToLedger(
      { ...EMPTY_LEDGER, accountMeta: { [EVERYDAY]: { currency: "AUD" }, [source]: { currency: "AUD" } } },
      {
        files: [file("up.csv")],
        transactions: [
          txn({ id: "keep", accountId: EVERYDAY, amount: -10 }),
          txn({ id: "move", accountId: source, amount: -20, merchant: "Coles", dateIso: "2026-06-01" }),
        ],
      },
      { importedAt: NOW },
    ).ledger;
    const created = mustOk(createPool(EMPTY_POOL_BOOK, { id: "pool-1", userId: "guest", name: "Holiday", now: NOW }));
    const withMember = mustOk(addPoolMember(created.book, "pool-1", source, {
      meta: { [source]: { kind: "CHECKING", currency: "AUD" } },
      now: NOW,
    }));
    const before = {
      ...held,
      accountPools: withMember.book.pools,
      accountPoolMembers: withMember.book.members,
    };
    const merged = mergeAccounts(before, source, EVERYDAY);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.equal(merged.ledger.accountPoolMembers?.[0]?.accountId, EVERYDAY);
    assert.equal(merged.ledger.mergedInto?.[source], EVERYDAY);
    const walked = applyMergedIntoToPoolMembers(withMember.book, merged.ledger.mergedInto ?? {});
    assert.equal(walked.members[0]?.accountId, EVERYDAY);
  });
});

describe("Spec 5 POOLS toggle and enable offer", () => {
  it("keeps POOLS off until offered, and the offer names Goals, Linked balances, and Pools", () => {
    assert.equal(isFeatureEnabled(undefined, "POOLS"), false);
    assert.equal(isFeatureEnabled(undefined, "GOALS"), false);
    assert.equal(isFeatureEnabled(undefined, "LINKED_BALANCES"), false);
    assert.deepEqual([...ENABLE_OFFER_KEYS], ["GOALS", "LINKED_BALANCES", "POOLS"]);
    assert.equal(shouldShowEnableOffer(undefined, undefined, false), false);
    assert.equal(shouldShowEnableOffer(undefined, undefined, true), true);
  });

  it("accepting the offer enables Pools; declining hides the offer and leaves data", () => {
    const accepted = acceptEnableOffer(undefined, ["POOLS"], NOW);
    assert.equal(isFeatureEnabled(accepted.toggles, "POOLS"), true);
    assert.equal(shouldShowEnableOffer(accepted.toggles, accepted.offer, true), false);

    const declined = dismissEnableOffer(undefined, NOW);
    assert.equal(shouldShowEnableOffer(undefined, declined, true), false);
    assert.equal(isFeatureEnabled(undefined, "POOLS"), false);
  });

  it("toggle-off archives the layout and leaves pool rows in place", () => {
    const { book } = bookWith();
    const off = setFeatureEnabled({ POOLS: true }, "POOLS", false);
    const layout = archiveLayoutEntry(undefined, "POOLS", NOW);
    assert.equal(isFeatureEnabled(off, "POOLS"), false);
    assert.equal(isLayoutArchived(layout, "POOLS"), true);
    assert.equal(book.pools.length, 1);
    const restored = restoreLayoutEntry(layout, "POOLS");
    assert.equal(isLayoutArchived(restored, "POOLS"), false);
  });

  it("Spec 4 toggle merge is guest OR account", () => {
    assert.deepEqual(mergeFeatureToggles({ POOLS: true }, { GOALS: true }), { POOLS: true, GOALS: true });
    assert.deepEqual(mergeFeatureToggles({ POOLS: false }, { POOLS: true }), { POOLS: true });
  });
});
