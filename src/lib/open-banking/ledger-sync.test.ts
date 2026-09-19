import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgetAutoPairs } from "@/lib/money-flow/auto-pairs";
import { EMPTY_LEDGER, fingerprintOf, ledgerTransactions, type Ledger, type LedgerEntry } from "@/lib/money-flow/ledger";
import { institutionOf, UNKNOWN_INSTITUTION } from "@/lib/money-flow/institution";
import { summarizeMoneyFlow } from "@/lib/money-flow/summary";
import { isCleared } from "@/lib/money-flow/tile";
import type { FiskilBankingAccount, FiskilBankingTransaction } from "@/lib/fiskil/banking";
import {
  applySilentSameInstitutionPairs,
  mapFiskilTransaction,
  openBankingSourceFile,
  upsertOpenBankingLedger,
} from "./ledger-sync";

function account(over: Partial<FiskilBankingAccount> & Pick<FiskilBankingAccount, "id">): FiskilBankingAccount {
  return {
    name: "Everyday",
    accountNumber: "100200300",
    institutionName: "NAB",
    ...over,
  };
}

function txn(
  over: Partial<FiskilBankingTransaction> & Pick<FiskilBankingTransaction, "id" | "accountId" | "amount" | "dateIso">,
): FiskilBankingTransaction {
  return {
    description: over.description ?? "Woolworths",
    status: over.status ?? "POSTED",
    ...over,
  };
}

function upsert(
  ledger: Ledger,
  accounts: FiskilBankingAccount[],
  transactions: FiskilBankingTransaction[],
  importedAt = "2026-09-19T12:00:00.000Z",
) {
  return upsertOpenBankingLedger(ledger, {
    consentId: "consent_1",
    accounts,
    transactions,
    importedAt,
    firstSync: ledger.entries.length === 0,
  });
}

describe("Open Banking ledger upsert", () => {
  it("inserts accounts and transactions with OPEN_BANKING ingest and Fiskil external_id", () => {
    const { ledger, report } = upsert(EMPTY_LEDGER, [account({ id: "acc_1" })], [
      txn({ id: "tx_1", accountId: "acc_1", amount: -12.5, dateIso: "2026-09-01" }),
    ]);
    assert.equal(report.added, 1);
    assert.equal(ledger.accountMeta?.["NAB · 100200300"]?.externalId, "acc_1");
    const row = ledger.entries[0]!;
    assert.equal(row.externalId, "tx_1");
    assert.equal(row.ingestSource, "OPEN_BANKING");
    assert.equal(row.status, "CLEARED");
    assert.equal(row.institution, "NAB");
    assert.equal(row.accountId, "NAB · 100200300");
  });

  it("updates PENDING to CLEARED in place and never inserts a second row", () => {
    const pending = upsert(EMPTY_LEDGER, [account({ id: "acc_1" })], [
      txn({ id: "tx_1", accountId: "acc_1", amount: -20, dateIso: "2026-09-02", status: "PENDING", description: "Hold" }),
    ]);
    assert.equal(pending.ledger.entries.length, 1);
    assert.equal(pending.ledger.entries[0]?.status, "PENDING");
    assert.equal(isCleared(ledgerTransactions(pending.ledger)[0]!), false);

    const settled = upsert(pending.ledger, [account({ id: "acc_1" })], [
      txn({ id: "tx_1", accountId: "acc_1", amount: -20, dateIso: "2026-09-02", status: "POSTED", description: "Hold" }),
    ]);
    assert.equal(settled.ledger.entries.length, 1);
    assert.equal(settled.report.added, 0);
    assert.equal(settled.ledger.entries[0]?.status, "CLEARED");
    assert.equal(settled.ledger.entries[0]?.externalId, "tx_1");
  });

  it("keeps PENDING out of Spec 10 tiles", () => {
    const { ledger } = upsert(EMPTY_LEDGER, [account({ id: "acc_1" })], [
      txn({ id: "pending", accountId: "acc_1", amount: -40, dateIso: "2026-09-03", status: "PENDING" }),
      txn({ id: "posted", accountId: "acc_1", amount: -10, dateIso: "2026-09-03", status: "POSTED", description: "Cafe" }),
    ]);
    const flow = summarizeMoneyFlow(ledgerTransactions(ledger));
    assert.equal(flow.spending, 10);
    assert.equal(ledger.entries.filter((row) => row.status === "PENDING").length, 1);
  });

  it("fingerprint-matches CSV+OB into one CLEARED survivor and opens DUPLICATE_HOLD", () => {
    const csv: LedgerEntry = {
      id: "csv-1",
      merchant: "Woolworths",
      categoryKey: "groceries",
      date: "1 Sep 2026",
      dateIso: "2026-09-01",
      amount: -12.5,
      baseAmount: -12.5,
      status: "CLEARED",
      type: "SPENDING",
      sourceFile: "nab.csv",
      confidence: 1,
      accountId: "NAB · 100200300",
      institution: "NAB",
      description: "Woolworths",
      decidedBy: "user_overridden",
      fingerprint: "",
      importIds: ["csv-import"],
      firstSeen: "2026-09-01T00:00:00.000Z",
    };
    csv.fingerprint = fingerprintOf({
      accountId: csv.accountId,
      sourceFile: csv.sourceFile,
      dateIso: csv.dateIso,
      amount: csv.amount,
      description: csv.description,
      merchant: csv.merchant,
    });
    const held: Ledger = { ...EMPTY_LEDGER, entries: [csv] };

    const { ledger, report } = upsert(held, [account({ id: "acc_1" })], [
      txn({ id: "tx_ob", accountId: "acc_1", amount: -12.5, dateIso: "2026-09-01", description: "Woolworths" }),
    ]);
    assert.equal(ledger.entries.length, 1);
    assert.equal(report.duplicates, 1);
    assert.equal(ledger.entries[0]?.status, "CLEARED");
    assert.equal(ledger.entries[0]?.decidedBy, "user_overridden");
    assert.equal(ledger.entries[0]?.externalId, "tx_ob");
    assert.equal(
      ledger.review?.some((item) => item.reason === "DUPLICATE_HOLD" && item.state === "OPEN"),
      true,
    );
  });

  it("does not overwrite user_overridden fields on an external_id update", () => {
    const first = upsert(EMPTY_LEDGER, [account({ id: "acc_1" })], [
      txn({ id: "tx_1", accountId: "acc_1", amount: -9, dateIso: "2026-09-04", description: "Pharmacy" }),
    ]);
    const entry = first.ledger.entries[0]!;
    entry.decidedBy = "user_overridden";
    entry.categoryKey = "health";
    entry.type = "SPENDING";

    const again = upsert(first.ledger, [account({ id: "acc_1" })], [
      txn({ id: "tx_1", accountId: "acc_1", amount: -9, dateIso: "2026-09-04", description: "Chemist Warehouse" }),
    ]);
    assert.equal(again.ledger.entries.length, 1);
    assert.equal(again.ledger.entries[0]?.decidedBy, "user_overridden");
    assert.equal(again.ledger.entries[0]?.categoryKey, "health");
    assert.equal(again.ledger.entries[0]?.description, "Pharmacy");
  });
});

describe("Spec 12.5 silent pairing", () => {
  it("silently pairs same-institution CLEARED Open Banking legs", () => {
    const everyday = account({ id: "acc_out", accountNumber: "100200300", name: "Everyday" });
    const savings = account({ id: "acc_in", accountNumber: "400500600", name: "Savings" });
    const { ledger } = upsert(EMPTY_LEDGER, [everyday, savings], [
      txn({
        id: "out",
        accountId: "acc_out",
        amount: -400,
        dateIso: "2026-09-05",
        description: "Transfer To Savings",
      }),
      txn({
        id: "in",
        accountId: "acc_in",
        amount: 400,
        dateIso: "2026-09-05",
        description: "Transfer From Everyday",
      }),
    ]);
    assert.equal(ledger.entries.length, 2);
    assert.ok(ledger.entries.every((row) => row.transferPair));
    assert.ok(ledger.entries.every((row) => row.type === "TRANSFER"));
    const kept = forgetAutoPairs(ledgerTransactions(ledger));
    assert.ok(kept.every((row) => row.transferPair), "silent OB pairs survive forgetAutoPairs");
    assert.equal(summarizeMoneyFlow(kept).transfers, 400);
  });

  it("does not silent-pair Unknown with Unknown", () => {
    const left = account({ id: "acc_a", accountNumber: "111111111", institutionName: undefined });
    const right = account({ id: "acc_b", accountNumber: "222222222", institutionName: undefined });
    const { ledger } = upsert(EMPTY_LEDGER, [left, right], [
      txn({ id: "out", accountId: "acc_a", amount: -50, dateIso: "2026-09-06", description: "Transfer" }),
      txn({ id: "in", accountId: "acc_b", amount: 50, dateIso: "2026-09-06", description: "Transfer" }),
    ]);
    assert.ok(ledgerTransactions(ledger).every((row) => institutionOf(row) === UNKNOWN_INSTITUTION));
    assert.ok(ledger.entries.every((row) => !row.transferPair));
  });

  it("re-runs pairing when institution becomes known", () => {
    const unknown = account({ id: "acc_out", accountNumber: "100200300", institutionName: undefined });
    const other = account({ id: "acc_in", accountNumber: "400500600", institutionName: undefined });
    const first = upsert(EMPTY_LEDGER, [unknown, other], [
      txn({ id: "out", accountId: "acc_out", amount: -80, dateIso: "2026-09-07", description: "Transfer To Savings" }),
      txn({ id: "in", accountId: "acc_in", amount: 80, dateIso: "2026-09-07", description: "Transfer From Everyday" }),
    ]);
    assert.ok(first.ledger.entries.every((row) => !row.transferPair));

    const named = upsert(
      first.ledger,
      [
        account({ id: "acc_out", accountNumber: "100200300", institutionName: "NAB" }),
        account({ id: "acc_in", accountNumber: "400500600", institutionName: "NAB" }),
      ],
      [
        txn({ id: "out", accountId: "acc_out", amount: -80, dateIso: "2026-09-07", description: "Transfer To Savings" }),
        txn({ id: "in", accountId: "acc_in", amount: 80, dateIso: "2026-09-07", description: "Transfer From Everyday" }),
      ],
    );
    assert.ok(named.ledger.entries.every((row) => row.institution === "NAB"));
    const paired = applySilentSameInstitutionPairs(named.ledger);
    assert.ok(paired.entries.every((row) => row.transferPair));
  });

  it("does not silent-pair while a leg is still PENDING", () => {
    const everyday = account({ id: "acc_out", accountNumber: "100200300" });
    const savings = account({ id: "acc_in", accountNumber: "400500600" });
    const { ledger } = upsert(EMPTY_LEDGER, [everyday, savings], [
      txn({
        id: "out",
        accountId: "acc_out",
        amount: -25,
        dateIso: "2026-09-08",
        description: "Transfer To Savings",
        status: "PENDING",
      }),
      txn({
        id: "in",
        accountId: "acc_in",
        amount: 25,
        dateIso: "2026-09-08",
        description: "Transfer From Everyday",
      }),
    ]);
    assert.ok(ledger.entries.every((row) => !row.transferPair));
  });
});

describe("Open Banking mapping", () => {
  it("uses the consent-scoped source file", () => {
    const mapped = mapFiskilTransaction(
      txn({ id: "tx", accountId: "acc_1", amount: -1, dateIso: "2026-09-01" }),
      {
        externalId: "acc_1",
        accountId: "NAB · 100200300",
        institution: "NAB",
        label: "Everyday",
      },
      "consent_1",
    );
    assert.equal(mapped.sourceFile, openBankingSourceFile("consent_1", "acc_1"));
    assert.equal(mapped.status, "CLEARED");
  });
});
