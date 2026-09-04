import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendToLedger,
  EMPTY_LEDGER,
  mergeLedgers,
  nameAccount,
  nameInstitution,
  recordPayerMerge,
  recordVerdict,
  removeStatement,
  type Ledger,
} from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import type { FileInterpretation, InterpretedTransaction } from "./types";
import { verdictFor } from "./verdicts";

let made = 0;

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant: "Cafe",
    category: "Dining",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -5,
    type: "expense",
    sourceFile: "statement.csv",
    confidence: 1,
    ...overrides,
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

/** A ledger holding one statement, as if it had been uploaded on its own device. */
function ledgerOf(filename: string, rows: InterpretedTransaction[], at: string): Ledger {
  return appendToLedger(
    EMPTY_LEDGER,
    { files: [file(filename)], transactions: rows.map((row) => ({ ...row, sourceFile: filename })) },
    { importedAt: at },
  ).ledger;
}

const LAPTOP = "2026-09-01T00:00:00.000Z";
const PHONE = "2026-09-02T00:00:00.000Z";

describe("bringing two copies of a ledger together", () => {
  it("keeps the statements both copies hold", () => {
    const laptop = ledgerOf("nab.csv", [txn({ amount: -20 }), txn({ amount: -30 })], LAPTOP);
    const phone = ledgerOf("up.csv", [txn({ amount: -40 })], PHONE);
    const merged = mergeLedgers(laptop, phone);

    assert.equal(merged.entries.length, 3, "nothing either device imported is dropped");
    assert.equal(merged.imports.length, 2);
    assert.equal(summarizeMoneyFlow(merged.entries).cashOut, 90);
  });

  it("counts a movement both copies already had exactly once", () => {
    const shared = txn({ accountKey: "100200300", description: "Coffee Roasters", amount: -12 });
    const laptop = ledgerOf("nab.csv", [shared], LAPTOP);
    // The same statement uploaded again on another device: same fingerprints.
    const phone = ledgerOf("nab.csv", [shared], PHONE);
    const merged = mergeLedgers(laptop, phone);

    assert.equal(merged.entries.length, 1);
    assert.equal(summarizeMoneyFlow(merged.entries).cashOut, 12);
  });

  it("remembers every import that carried a shared movement", () => {
    const shared = txn({ accountKey: "100200300", description: "Rent", amount: -900 });
    const laptop = ledgerOf("jan-jun.csv", [shared], LAPTOP);
    const phone = ledgerOf("may-sep.csv", [shared], PHONE);
    const merged = mergeLedgers(laptop, phone);

    assert.equal(merged.entries[0].importIds.length, 2, "both statements cover it");
    // So removing one statement leaves the movement the other still covers.
    const left = removeStatement(merged, "jan-jun.csv");
    assert.equal(left.entries.length, 1);
  });

  it("dates a shared movement from whichever copy saw it first", () => {
    const shared = txn({ accountKey: "100200300", description: "Rent", amount: -900 });
    const merged = mergeLedgers(ledgerOf("a.csv", [shared], PHONE), ledgerOf("b.csv", [shared], LAPTOP));
    assert.equal(merged.entries[0].firstSeen, LAPTOP);
  });

  it("is the same ledger whichever way round the two copies come", () => {
    const laptop = ledgerOf("nab.csv", [txn({ amount: -20 })], LAPTOP);
    const phone = ledgerOf("up.csv", [txn({ amount: -40 })], PHONE);
    const shape = (ledger: Ledger) => ({
      entries: ledger.entries.map((entry) => entry.fingerprint).sort(),
      imports: ledger.imports.map((record) => record.id).sort(),
    });

    assert.deepEqual(shape(mergeLedgers(laptop, phone)), shape(mergeLedgers(phone, laptop)));
  });
});

describe("bringing together what a person said on each device", () => {
  const base = () => ledgerOf("nab.csv", [txn({ accountKey: "100200300" })], LAPTOP);

  it("keeps a name given on one device and an account named on the other", () => {
    const laptop = nameInstitution(base(), "nab.csv", "NAB");
    const phone = nameAccount(base(), "NAB · 100200300", "Everyday");
    const merged = mergeLedgers(laptop, phone);

    assert.equal(merged.institutions?.["nab.csv"], "NAB");
    assert.equal(merged.accounts?.["NAB · 100200300"], "Everyday");
  });

  it("keeps a payer merge made on either device", () => {
    const laptop = recordPayerMerge(base(), "like|a", "like|b");
    const phone = recordPayerMerge(base(), "like|c", "like|d");
    const merged = mergeLedgers(laptop, phone);

    assert.deepEqual(merged.payers, { "like|a": "like|b", "like|c": "like|d" });
  });

  it("lets a later verdict win over an earlier one, whichever device it came from", () => {
    const older = recordVerdict(base(), "like|loan", verdictFor("earned", LAPTOP));
    const newer = recordVerdict(base(), "like|loan", verdictFor("borrowed", PHONE));

    // The newer answer wins from either side, so sync order cannot decide it.
    assert.equal(mergeLedgers(older, newer).verdicts?.["like|loan"].because, "borrowed");
    assert.equal(mergeLedgers(newer, older).verdicts?.["like|loan"].because, "borrowed");
  });

  it("says nothing about a ledger nobody has said anything about", () => {
    const merged = mergeLedgers(base(), base());
    assert.equal(merged.verdicts, undefined);
    assert.equal(merged.accounts, undefined);
    assert.equal(merged.institutions, undefined);
    assert.equal(merged.payers, undefined);
  });

  it("takes a fresh copy on either side without disturbing the other", () => {
    const held = nameAccount(base(), "NAB · 100200300", "Everyday");

    // Signing in on a new device: nothing local, everything from the cloud.
    assert.deepEqual(mergeLedgers(EMPTY_LEDGER, held).accounts, held.accounts);
    // First sign-in from a device that already has data: nothing in the cloud yet.
    assert.deepEqual(mergeLedgers(held, EMPTY_LEDGER).accounts, held.accounts);
    assert.equal(mergeLedgers(EMPTY_LEDGER, held).entries.length, 1);
    assert.equal(mergeLedgers(held, EMPTY_LEDGER).entries.length, 1);
  });
});

describe("the samples, split across two devices", () => {
  it("reads the same as one ledger holding both statements", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { interpretDocuments } = await import("./interpret");
    const dir = path.join(process.cwd(), "public/samples");

    const read = async (name: string) =>
      interpretDocuments(
        [
          {
            filename: name,
            mime: name.endsWith(".csv") ? "text/csv" : "text/plain",
            bytes: new Uint8Array(readFileSync(path.join(dir, name))),
          },
        ],
        { ai: null },
      );

    const medicare = await read("nab-medicare.csv");
    const rent = await read("nab-rent.csv");

    // One device has each statement, and neither has the other.
    const laptop = appendToLedger(EMPTY_LEDGER, medicare, { importedAt: LAPTOP }).ledger;
    const phone = appendToLedger(EMPTY_LEDGER, rent, { importedAt: PHONE }).ledger;
    const merged = mergeLedgers(laptop, phone);

    // The same as having uploaded both to one browser: 437 movements, $204,214.49 in.
    const together = appendToLedger(
      appendToLedger(EMPTY_LEDGER, medicare, { importedAt: LAPTOP }).ledger,
      rent,
      { importedAt: PHONE },
    ).ledger;

    assert.equal(merged.entries.length, 437);
    assert.equal(merged.entries.length, together.entries.length);
    assert.equal(summarizeMoneyFlow(merged.entries).cashIn, 204214.49);
    assert.equal(summarizeMoneyFlow(merged.entries).cashOut, 203665.05);
    assert.equal(summarizeMoneyFlow(merged.entries).cashNet, 549.44);
  });
});
