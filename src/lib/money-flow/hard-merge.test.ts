/**
 * Slice 4: Spec 6c hard merge × fingerprint.
 *
 * Source → survivor is irreversible. Ledger rows remap and recompute fingerprints.
 * Collisions stay one CLEARED row with OPEN DUPLICATE_HOLD. Same-account transfer
 * pairs collapse into UNPAIRED_TRANSFER. Re-import matches the survivor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountsFrom } from "./accounts";
import { canonicalAccountId, mergeWouldCycle } from "./account-identity";
import {
  appendToLedger,
  EMPTY_LEDGER,
  fingerprintOf,
  ledgerTransactions,
  mergeAccounts,
  nameAccount,
  parseLedger,
  type Ledger,
} from "./ledger";
import { buildReviewQueue, confirmTransferPair } from "./review-queue";
import { summarizeMoneyFlow } from "./summary";
import type { FileInterpretation, InterpretedTransaction } from "./types";

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: over.id ?? "a",
    merchant: over.merchant ?? "Woolworths Bondi",
    categoryKey: over.categoryKey ?? "groceries",
    date: over.date ?? "15 May",
    dateIso: over.dateIso ?? "2026-05-15",
    amount: over.amount ?? -86.4,
    type: over.type ?? "spent",
    sourceFile: over.sourceFile ?? "statement.csv",
    confidence: 1,
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

function upload(rows: InterpretedTransaction[]) {
  const names = [...new Set(rows.map((row) => row.sourceFile))];
  return { files: names.map(file), transactions: rows };
}

function ledgerOf(rows: InterpretedTransaction[], at = "2026-09-01T00:00:00.000Z"): Ledger {
  return appendToLedger(EMPTY_LEDGER, upload(rows), { importedAt: at }).ledger;
}

const SURVIVOR = "Up · 700000000";
const SOURCE = "Up · ···000";

describe("remap and recompute", () => {
  it("rewrites source rows onto the survivor account and fingerprint", () => {
    const held = ledgerOf([
      txn({ id: "keep", accountId: SURVIVOR, amount: -10, merchant: "Cafe" }),
      txn({ id: "move", accountId: SOURCE, amount: -20, merchant: "Coles", dateIso: "2026-06-01" }),
    ]);

    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;

    const moved = merged.ledger.entries.find((row) => row.id === "move");
    assert.equal(moved?.accountId, SURVIVOR);
    assert.equal(
      moved?.fingerprint,
      fingerprintOf({ ...moved!, accountId: SURVIVOR }, 0, merged.ledger.mergedInto),
    );
    assert.equal(canonicalAccountId(SOURCE, merged.ledger.mergedInto), SURVIVOR);
    assert.ok(!moved?.fingerprint.includes("···000"));
  });
});

describe("no undo", () => {
  it("keeps merged_into when a name is cleared", () => {
    const held = ledgerOf([
      txn({ id: "keep", accountId: SURVIVOR }),
      txn({ id: "move", accountId: SOURCE, amount: -20, merchant: "Coles" }),
    ]);
    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;

    const unnamed = nameAccount(merged.ledger, SOURCE, "");
    assert.equal(unnamed.mergedInto?.[SOURCE], SURVIVOR);
    assert.equal(unnamed.entries.find((row) => row.id === "move")?.accountId, SURVIVOR);
    assert.equal(accountsFrom(ledgerTransactions(unnamed), { mergedInto: unnamed.mergedInto }).length, 1);
  });

  it("round-trips merged_into through parseLedger with no unmerge field", () => {
    const held = ledgerOf([txn({ accountId: SURVIVOR }), txn({ id: "b", accountId: SOURCE, amount: -2 })]);
    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    const restored = parseLedger(JSON.parse(JSON.stringify(merged.ledger)));
    assert.equal(restored?.mergedInto?.[SOURCE], SURVIVOR);
    assert.equal("unmerge" in (restored ?? {}), false);
  });
});

describe("fingerprint collision on remap", () => {
  it("keeps one CLEARED row, opens DUPLICATE_HOLD, and does not double Net or cash", () => {
    const held = ledgerOf([
      txn({ id: "survivor", accountId: SURVIVOR, amount: -86.4, decidedBy: "said", userFlaggedSavings: true }),
      txn({ id: "source", accountId: SOURCE, amount: -86.4 }),
    ]);
    const before = summarizeMoneyFlow(ledgerTransactions(held));
    assert.equal(before.cashOut, 172.8);

    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;

    assert.equal(merged.ledger.entries.length, 1);
    const kept = merged.ledger.entries[0];
    assert.equal(kept?.id, "survivor");
    assert.equal(kept?.status ?? "CLEARED", "CLEARED");
    assert.equal(kept?.decidedBy, "said", "prefer survivor user_overridden");
    assert.equal(kept?.userFlaggedSavings, true);
    assert.ok(kept?.importIds.length === 1);

    const hold = (merged.ledger.review ?? []).find((item) => item.reason === "DUPLICATE_HOLD");
    assert.equal(hold?.state, "OPEN");
    assert.deepEqual(hold?.movementIds, [], "empty so the survivor is not tile-held");

    const after = summarizeMoneyFlow(ledgerTransactions(merged.ledger));
    assert.equal(after.cashOut, 86.4);
    assert.equal(after.spending, 86.4);
    assert.equal(after.net, -86.4);

    const queue = buildReviewQueue(ledgerTransactions(merged.ledger), { stored: merged.ledger.review });
    assert.ok(queue.some((item) => item.reason === "DUPLICATE_HOLD" && item.state === "OPEN"));
  });

  it("copies source user_overridden onto a survivor that has none", () => {
    const held = ledgerOf([
      txn({ id: "survivor", accountId: SURVIVOR, amount: -86.4 }),
      txn({ id: "source", accountId: SOURCE, amount: -86.4, decidedBy: "said", userFlaggedSavings: true }),
    ]);
    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    const kept = merged.ledger.entries[0];
    assert.equal(kept?.id, "survivor");
    assert.equal(kept?.decidedBy, "said");
    assert.equal(kept?.userFlaggedSavings, true);
  });
});

describe("re-import after merge", () => {
  it("matches survivor fingerprints and does not add a second CLEARED row or inflate Net", () => {
    const first = ledgerOf([
      txn({ id: "survivor", accountId: SURVIVOR, amount: -50, merchant: "Rent" }),
      txn({ id: "source", accountId: SOURCE, amount: -12, merchant: "Bus" }),
    ]);
    const merged = mergeAccounts(first, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    const netBefore = summarizeMoneyFlow(ledgerTransactions(merged.ledger)).net;

    const again = appendToLedger(
      merged.ledger,
      upload([
        txn({ id: "source-again", accountId: SOURCE, amount: -12, merchant: "Bus", sourceFile: "later.csv" }),
      ]),
      { importedAt: "2026-09-03T00:00:00.000Z" },
    );

    assert.equal(again.report.added, 0);
    assert.equal(again.report.duplicates, 1);
    assert.equal(again.ledger.entries.length, merged.ledger.entries.length);
    assert.equal(summarizeMoneyFlow(ledgerTransactions(again.ledger)).net, netBefore);
    assert.equal(again.ledger.entries.filter((row) => (row.status ?? "CLEARED") === "CLEARED").length, again.ledger.entries.length);
  });
});

describe("same-account transfer pair collapse", () => {
  it("breaks the pair and opens UNPAIRED_TRANSFER", () => {
    const debit = txn({
      id: "out",
      accountId: SURVIVOR,
      amount: -400,
      dateIso: "2026-03-12",
      merchant: "Transfer To Save!!",
      categoryKey: "uncategorised",
      type: "spent",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const credit = txn({
      id: "in-save",
      accountId: SOURCE,
      amount: 400,
      dateIso: "2026-03-12",
      merchant: "Transfer From Spending",
      categoryKey: "uncategorised",
      type: "earned",
      bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
    });
    const held = ledgerOf([debit, credit]);
    const confirmed = confirmTransferPair(ledgerTransactions(held), "out", "in-save");
    const paired: Ledger = {
      ...held,
      entries: held.entries.map((entry) => {
        const next = confirmed.find((row) => row.id === entry.id);
        return next ? { ...entry, ...next } : entry;
      }),
    };

    assert.ok(paired.entries.every((row) => row.transferPair));

    const merged = mergeAccounts(paired, SOURCE, SURVIVOR);
    assert.equal(merged.ok, true);
    if (!merged.ok) return;

    assert.ok(merged.ledger.entries.every((row) => !row.transferPair), "never leave same-account TRANSFER");
    assert.ok(merged.ledger.entries.every((row) => row.accountId === SURVIVOR));

    const rows = ledgerTransactions(merged.ledger);
    const queue = buildReviewQueue(rows, { stored: merged.ledger.review });
    assert.ok(queue.some((item) => item.reason === "UNPAIRED_TRANSFER" && item.state === "OPEN"));
    assert.equal(summarizeMoneyFlow(rows).transfers, 0);
    assert.ok(!rows.some((row) => row.transferPair && row.accountId === SURVIVOR));
  });
});

describe("Spec 6 hard blocks", () => {
  it("refuses a currency mismatch", () => {
    const held = {
      ...ledgerOf([txn({ accountId: SURVIVOR }), txn({ id: "usd", accountId: SOURCE, amount: -1 })]),
      accountMeta: { [SURVIVOR]: { currency: "AUD" }, [SOURCE]: { currency: "USD" } },
    };
    const merged = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(merged.ok, false);
    if (merged.ok) return;
    assert.match(merged.reason, /USD|AUD/);
  });

  it("refuses CREDIT/LOAN/MORTGAGE into CHECKING/SAVINGS", () => {
    const credit = "NAB · Credit";
    const checking = "NAB · Everyday";
    const held = ledgerOf([
      txn({ id: "c", accountId: credit, amount: -1 }),
      txn({ id: "k", accountId: checking, amount: -2 }),
    ]);
    const blocked = mergeAccounts(held, credit, checking);
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.reason, /CREDIT/);
  });

  it("allows CHECKING into SAVINGS", () => {
    const checking = "Up · Spending";
    const savings = "Up · Save!!";
    const held = ledgerOf([
      txn({ id: "c", accountId: checking, amount: -5, merchant: "A" }),
      txn({ id: "s", accountId: savings, amount: -7, merchant: "B" }),
    ]);
    const merged = mergeAccounts(held, checking, savings);
    assert.equal(merged.ok, true);
  });

  it("refuses merging the survivor back into the source", () => {
    const held = ledgerOf([
      txn({ accountId: SURVIVOR }),
      txn({ id: "b", accountId: SOURCE, amount: -2 }),
    ]);
    const first = mergeAccounts(held, SOURCE, SURVIVOR);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const loop = mergeAccounts(first.ledger, SURVIVOR, SOURCE);
    assert.equal(loop.ok, false);
  });

  it("detects a cycle in merged_into before writing it", () => {
    assert.equal(mergeWouldCycle("A", "B", { B: "A" }), true);
    assert.equal(mergeWouldCycle("A", "C", { A: "B" }), false);
  });
});
