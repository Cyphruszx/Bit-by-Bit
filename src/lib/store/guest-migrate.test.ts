/**
 * Spec 4 — guest → account migration.
 *
 * Merge / Keep / Replace, fingerprint and rule conflicts → Review Queue,
 * account match, quota max + seal, Core toggle OR. Soft pools are not started.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendToLedger, EMPTY_LEDGER, fingerprintOf, parseLedger, type Ledger } from "@/lib/money-flow/ledger";
import { memoryQuotaStore, migrateQuotas, peekQuota, quotaSubject, tryChargeCsv } from "@/lib/money-flow/core-ingest";
import { buildReviewQueue, holdsTiles } from "@/lib/money-flow/review-queue";
import type { FileInterpretation, InterpretedTransaction } from "@/lib/money-flow/types";
import { DEFAULT_SHELL, mergeShells, setFeature, upsertGoal, type ShellState } from "@/lib/shell/core-shell";
import {
  alreadyMigrated,
  applyGuestMigration,
  copyGuestLedger,
  holdsMigratable,
  inspectMigration,
  matchAccounts,
  mergeMigrateRules,
  pickFingerprint,
  REPLACE_CONFIRM_PHRASE,
  remapGuestAccounts,
  stampMigration,
  type MigrationAccount,
} from "./guest-migrate";

let made = 0;

function txn(over: Partial<InterpretedTransaction> & { merchant: string; amount: number }): InterpretedTransaction {
  made += 1;
  return {
    id: over.id ?? `m${made}`,
    merchant: over.merchant,
    categoryKey: over.categoryKey ?? "groceries",
    date: over.date ?? "1 Jun",
    dateIso: over.dateIso ?? "2026-06-01",
    amount: over.amount,
    type: over.type ?? (over.amount < 0 ? "spent" : "earned"),
    sourceFile: over.sourceFile ?? "statement.csv",
    confidence: 1,
    decidedBy: over.decidedBy,
    accountId: over.accountId,
    accountKey: over.accountKey,
    tags: over.tags,
    userFlaggedSavings: over.userFlaggedSavings,
    description: over.description ?? over.merchant,
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
    notes: ["ocr:page-1"],
    ocrPages: filename.endsWith(".png") ? 1 : undefined,
  };
}

function ledgerOf(
  filename: string,
  rows: InterpretedTransaction[],
  at = "2026-06-02T00:00:00.000Z",
): Ledger {
  return appendToLedger(
    EMPTY_LEDGER,
    { files: [file(filename)], transactions: rows.map((row) => ({ ...row, sourceFile: filename })) },
    { importedAt: at },
  ).ledger;
}

function withOverride(row: InterpretedTransaction, categoryKey: string): InterpretedTransaction {
  return { ...row, categoryKey, decidedBy: "user_overridden" };
}

function mustApply(...args: Parameters<typeof applyGuestMigration>) {
  const applied = applyGuestMigration(...args);
  if (!applied.ok) throw new Error(applied.reason);
  return applied.result;
}

describe("Spec 4 inspect: empty / both / already done", () => {
  it("copies guest when the account is empty", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const offer = inspectMigration(guest, EMPTY_LEDGER, "dev-1");
    assert.equal(offer.kind, "copy-guest");
    const copied = copyGuestLedger(guest, "dev-1");
    assert.equal(copied.ledger.entries.length, 1);
    assert.equal(copied.ledger.migration?.fromGuestId, "dev-1");
    assert.equal(copied.ledger.imports[0]?.notes.includes("ocr:page-1"), true);
  });

  it("keeps the account when the guest is empty", () => {
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]);
    const offer = inspectMigration(EMPTY_LEDGER, account, "dev-1");
    assert.equal(offer.kind, "keep-account");
  });

  it("asks when both have statements", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]);
    assert.equal(inspectMigration(guest, account, "dev-1").kind, "choose");
  });

  it("is idempotent on the same guest id", () => {
    const account = stampMigration(ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]), "dev-1");
    assert.equal(alreadyMigrated(account, "dev-1"), true);
    assert.equal(inspectMigration(ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]), account, "dev-1").kind, "already-done");
    const again = mustApply(inspectMigration(ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]), account, "dev-1"), {
      action: "merge",
    });
    assert.equal(again.ledger.entries.some((entry) => entry.merchant === "Cafe"), false);
    assert.equal(again.ledger.migration?.fromGuestId, "dev-1");
  });
});

describe("Spec 4 Merge / Keep / Replace", () => {
  it("Merge keeps both statements and copies OCR import artifacts", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5, accountId: "NAB · Everyday" })]);
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12, accountId: "Upx · Spending" })]);
    const offer = inspectMigration(guest, account, "dev-1");
    const merged = mustApply(offer, { action: "merge" });
    assert.deepEqual(
      merged.ledger.entries.map((entry) => entry.merchant).sort(),
      ["Cafe", "Chemist"],
    );
    assert.ok(merged.ledger.imports.some((record) => record.filename === "june.csv" && record.notes.includes("ocr:page-1")));
    assert.ok(merged.ledger.imports.some((record) => record.filename === "may.csv"));
    assert.equal(merged.ledger.migration?.status, "done");
  });

  it("Keep account only leaves guest statements out", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]);
    const kept = mustApply(inspectMigration(guest, account, "dev-1"), { action: "keep-account" });
    assert.deepEqual(
      kept.ledger.entries.map((entry) => entry.merchant),
      ["Chemist"],
    );
    assert.equal(kept.ledger.migration?.fromGuestId, "dev-1");
  });

  it("Replace with guest wipes the account after the scary confirm", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]);
    const refused = applyGuestMigration(inspectMigration(guest, account, "dev-1"), {
      action: "replace-guest",
      confirm: "please",
    });
    assert.equal(refused.ok, false);

    const replaced = mustApply(inspectMigration(guest, account, "dev-1"), {
      action: "replace-guest",
      confirm: REPLACE_CONFIRM_PHRASE,
    });
    assert.deepEqual(
      replaced.ledger.entries.map((entry) => entry.merchant),
      ["Cafe"],
    );
    assert.equal(replaced.ledger.entries.some((entry) => entry.merchant === "Chemist"), false);
  });
});

describe("Spec 4 fingerprint conflict → Review Queue", () => {
  const row = txn({
    merchant: "Cafe",
    amount: -5,
    accountId: "NAB · Everyday",
    dateIso: "2026-06-01",
    description: "Cafe",
  });

  it("one override wins and does not open RQ", () => {
    const guest = ledgerOf("june.csv", [withOverride(row, "restaurants")]);
    const account = ledgerOf("june.csv", [row]);
    const guestEntry = guest.entries[0]!;
    const accountEntry = account.entries[0]!;
    assert.equal(guestEntry.fingerprint, accountEntry.fingerprint);
    const picked = pickFingerprint(guestEntry, accountEntry);
    assert.equal(picked.entry.categoryKey, "restaurants");
    assert.equal(picked.conflict, undefined);

    const merged = mustApply(inspectMigration(guest, account, "dev-1"), { action: "merge" });
    assert.equal(merged.ledger.entries[0]?.categoryKey, "restaurants");
    assert.equal(
      merged.review.some((item) => item.reason === "FINGERPRINT_CONFLICT"),
      false,
    );
  });

  it("neither override keeps the cloud row", () => {
    const guest = ledgerOf("june.csv", [{ ...row, categoryKey: "restaurants" }]);
    const account = ledgerOf("june.csv", [{ ...row, categoryKey: "groceries" }]);
    const picked = pickFingerprint(guest.entries[0]!, account.entries[0]!);
    assert.equal(picked.entry.categoryKey, "groceries");
    assert.equal(picked.conflict, undefined);
  });

  it("both different overrides open FINGERPRINT_CONFLICT and hold tiles", () => {
    const guest = ledgerOf("june.csv", [withOverride({ ...row, id: "g" }, "restaurants")]);
    const account = ledgerOf("june.csv", [withOverride({ ...row, id: "a" }, "groceries")]);
    const merged = mustApply(inspectMigration(guest, account, "dev-1"), { action: "merge" });
    const conflict = merged.review.find((item) => item.reason === "FINGERPRINT_CONFLICT");
    assert.ok(conflict);
    assert.equal(conflict?.state, "OPEN");
    assert.equal(merged.ledger.entries[0]?.categoryKey, "groceries", "cloud row is what stays");
    const queue = buildReviewQueue([], { stored: merged.review });
    assert.ok(queue.some((item) => item.reason === "FINGERPRINT_CONFLICT" && item.state === "OPEN"));
    assert.equal(holdsTiles("FINGERPRINT_CONFLICT"), true);
  });
});

describe("Spec 4 rule conflict → Review Queue", () => {
  it("unions the same trigger and action", () => {
    const merged = mergeMigrateRules(
      { cafe: { categoryKey: "restaurants", at: "2026-06-01T00:00:00.000Z" } },
      { cafe: { categoryKey: "restaurants", at: "2026-05-01T00:00:00.000Z" } },
    );
    assert.equal(merged.rules.cafe?.categoryKey, "restaurants");
    assert.equal(merged.conflicts.length, 0);
  });

  it("same trigger, different action, priority tie → RULE_CONFLICT", () => {
    const merged = mergeMigrateRules(
      { cafe: { categoryKey: "restaurants", at: "2026-06-01T00:00:00.000Z" } },
      { cafe: { categoryKey: "groceries", at: "2026-05-01T00:00:00.000Z" } },
    );
    assert.equal(Object.keys(merged.rules).length, 0);
    assert.equal(merged.conflicts[0]?.reason, "RULE_CONFLICT");
    assert.equal(merged.conflicts[0]?.state, "OPEN");
    assert.equal(holdsTiles("RULE_CONFLICT"), true);
  });

  it("higher priority wins without opening RQ", () => {
    const merged = mergeMigrateRules(
      { cafe: { categoryKey: "restaurants", at: "2026-06-01T00:00:00.000Z", priority: 10 } },
      { cafe: { categoryKey: "groceries", at: "2026-05-01T00:00:00.000Z", priority: 0 } },
    );
    assert.equal(merged.rules.cafe?.categoryKey, "restaurants");
    assert.equal(merged.conflicts.length, 0);
  });

  it("Merge writes RULE_CONFLICT onto the ledger Review Queue", () => {
    const guest = {
      ...ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]),
      rules: { cafe: { categoryKey: "restaurants", at: "2026-06-01T00:00:00.000Z" } },
    };
    const account = {
      ...ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]),
      rules: { cafe: { categoryKey: "groceries", at: "2026-05-01T00:00:00.000Z" } },
    };
    const merged = mustApply(inspectMigration(guest, account, "dev-1"), { action: "merge" });
    assert.ok(merged.review.some((item) => item.reason === "RULE_CONFLICT" && item.state === "OPEN"));
    const queue = buildReviewQueue([], { stored: merged.review });
    assert.ok(queue.some((item) => item.reason === "RULE_CONFLICT"));
  });
});

describe("Spec 4 account match then remap", () => {
  it("matches external_id first", () => {
    const guest: MigrationAccount[] = [{ id: "g-1", name: "Everyday", kind: "CHECKING", externalId: "nab-88" }];
    const account: MigrationAccount[] = [{ id: "a-1", name: "Spending", kind: "CHECKING", externalId: "nab-88" }];
    assert.deepEqual(matchAccounts(guest, account).mapped, { "g-1": "a-1" });
    assert.equal(matchAccounts(guest, account).needsPick.length, 0);
  });

  it("matches unique name+type and asks when the name is shared", () => {
    const unique = matchAccounts(
      [{ id: "g-1", name: "Everyday", kind: "CHECKING" }],
      [{ id: "a-1", name: "Everyday", kind: "CHECKING" }],
    );
    assert.deepEqual(unique.mapped, { "g-1": "a-1" });

    const pick = matchAccounts(
      [{ id: "g-1", name: "Everyday", kind: "SAVINGS" }],
      [
        { id: "a-1", name: "Everyday", kind: "CHECKING" },
        { id: "a-2", name: "Everyday", kind: "SAVINGS" },
      ],
    );
    assert.deepEqual(pick.mapped, { "g-1": "a-2" });

    const ambiguous = matchAccounts(
      [{ id: "g-1", name: "Everyday", kind: "CHECKING" }],
      [
        { id: "a-1", name: "Everyday", kind: "CREDIT" },
        { id: "a-2", name: "Everyday", kind: "LOAN" },
      ],
    );
    assert.equal(ambiguous.needsPick.length, 1);
    assert.equal(ambiguous.needsPick[0]?.guest.id, "g-1");
  });

  it("remaps guest account_ids and fingerprints onto the survivor", () => {
    const guestRow = txn({
      merchant: "Cafe",
      amount: -5,
      accountId: "NAB · Everyday",
      dateIso: "2026-06-01",
      description: "Cafe",
    });
    const guest = {
      ...ledgerOf("june.csv", [guestRow]),
      accounts: { "NAB · Everyday": "Everyday" },
    };
    const remapped = remapGuestAccounts(guest, { "NAB · Everyday": "Up · Spending" });
    assert.equal(remapped.entries[0]?.accountId, "Up · Spending");
    assert.equal(
      remapped.entries[0]?.fingerprint,
      fingerprintOf({ ...guestRow, accountId: "Up · Spending" }, 0, { "NAB · Everyday": "Up · Spending" }),
    );
  });
});

describe("Spec 4 Core toggles = guest OR account", () => {
  it("enables Goals or Linked if either side had them, and never invents extra widgets", () => {
    const guest = setFeature(
      upsertGoal(DEFAULT_SHELL, { id: "holiday", name: "Holiday", allocated: 200 }),
      "goals",
      true,
    );
    const account = setFeature(DEFAULT_SHELL, "linked-balances", true);
    const merged = mergeShells(guest, account);
    assert.equal(merged.enabled.goals, true);
    assert.equal(merged.enabled.linkedBalances, true);
    assert.ok(merged.goals.some((goal) => goal.id === "holiday"));
    assert.equal(
      merged.widgets.some((entry) => entry.id !== "money-tiles" && entry.id !== "goals" && entry.id !== "linked-balances"),
      false,
    );
  });

  it("Merge writes the OR-ed shell onto the ledger, including linked views", () => {
    const guestShell: ShellState = setFeature(
      { ...DEFAULT_SHELL, linkedAccountIds: ["NAB · Everyday"] },
      "linked-balances",
      true,
    );
    const accountShell = DEFAULT_SHELL;
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const account = ledgerOf("may.csv", [txn({ merchant: "Chemist", amount: -12 })]);
    const merged = mustApply(inspectMigration(guest, account, "dev-1", guestShell, accountShell), { action: "merge" });
    assert.equal(merged.shell.enabled.linkedBalances, true);
    assert.deepEqual(merged.shell.linkedAccountIds, ["NAB · Everyday"]);
    assert.equal(merged.ledger.shell?.enabled.linkedBalances, true);
  });
});

describe("Spec 4 quotas max + seal + idempotent", () => {
  const at = new Date("2026-09-14T04:00:00.000Z");

  it("takes max(guest, user) for the current AU week and seals the guest", () => {
    const store = memoryQuotaStore();
    store.write(quotaSubject({ deviceId: "dev-1" }), { week: "2026-09-14", csv: 3, ocrPages: 8 });
    store.write(quotaSubject({ userId: "user-9" }), { week: "2026-09-14", csv: 1, ocrPages: 12 });
    const merged = migrateQuotas(store, "dev-1", "user-9", at);
    assert.equal(merged.csv, 3);
    assert.equal(merged.ocrPages, 12);
    assert.equal(merged.migratedFromGuestId, "dev-1");
    assert.equal(merged.migrationStatus, "done");
    assert.equal(peekQuota(store, quotaSubject({ deviceId: "dev-1" }), at).sealed, true);
    assert.equal(tryChargeCsv(store, quotaSubject({ deviceId: "dev-1" }), at).ok, false);
    assert.equal(tryChargeCsv(store, quotaSubject({ userId: "user-9" }), at).ok, true);
  });

  it("does not run twice for the same guest id", () => {
    const store = memoryQuotaStore();
    store.write(quotaSubject({ deviceId: "dev-1" }), { week: "2026-09-14", csv: 4, ocrPages: 1 });
    store.write(quotaSubject({ userId: "user-9" }), { week: "2026-09-14", csv: 0, ocrPages: 0 });
    migrateQuotas(store, "dev-1", "user-9", at);
    store.write(quotaSubject({ deviceId: "dev-1" }), { week: "2026-09-14", csv: 5, ocrPages: 20, sealed: true });
    const again = migrateQuotas(store, "dev-1", "user-9", at);
    assert.equal(again.csv, 4, "idempotent — later guest charges are ignored");
  });
});

describe("Spec 4 parse / copy extras", () => {
  it("round-trips migration + shell through parseLedger", () => {
    const guest = ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })]);
    const copied = copyGuestLedger(guest, "dev-1", setFeature(DEFAULT_SHELL, "goals", true));
    const parsed = parseLedger(copied.ledger);
    assert.equal(parsed?.migration?.fromGuestId, "dev-1");
    assert.equal(parsed?.shell?.enabled.goals, true);
  });

  it("does not treat a default empty pair as migratable work", () => {
    assert.equal(holdsMigratable(EMPTY_LEDGER, DEFAULT_SHELL), false);
    assert.equal(holdsMigratable(ledgerOf("june.csv", [txn({ merchant: "Cafe", amount: -5 })])), true);
  });
});
