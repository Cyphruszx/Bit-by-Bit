import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { interpretDocuments } from "./interpret";
import {
  appendToLedger,
  EMPTY_LEDGER,
  fingerprintOf,
  heldStatements,
  ledgerTransactions,
  nameAccount,
  parseLedger,
  removeImport,
  removeStatement,
  visibleTransactions,
} from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import { markRefundLegs } from "./refunds";
import { markTransferLegs } from "./transfers";
import type { FileInterpretation, InterpretedTransaction } from "./types";

function txn(overrides: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  return {
    id: "a",
    merchant: "Cafe",
    categoryKey: "food.restaurants",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount: -5,
    type: "spent",
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

function upload(transactions: InterpretedTransaction[]) {
  const names = [...new Set(transactions.map((row) => row.sourceFile))];
  return { files: names.map(file), transactions };
}

const samples = path.join(process.cwd(), "public/samples");

async function readSamples(names: string[]) {
  return interpretDocuments(
    names.map((filename) => ({
      filename,
      mime: "text/csv",
      bytes: new Uint8Array(readFileSync(path.join(samples, filename))),
    })),
    { ai: null },
  );
}

describe("movement fingerprints", () => {
  it("identifies a movement by account, date, amount and wording, not by filename", () => {
    const june = txn({ accountKey: "100200300", description: "Coffee Roasters 123" });
    assert.equal(
      fingerprintOf(june),
      fingerprintOf({ ...june, sourceFile: "renamed-export.csv", id: "different" }),
    );
  });

  it("keeps two accounts apart even when the movements look identical", () => {
    const everyday = txn({ accountKey: "100200300", description: "Account fee" });
    const offset = txn({ accountKey: "400500600", description: "Account fee" });
    assert.notEqual(fingerprintOf(everyday), fingerprintOf(offset));
  });

  it("falls back to the file when the export never names an account", () => {
    assert.equal(fingerprintOf(txn({ sourceFile: "one.csv" })).startsWith("file:one.csv"), true);
  });
});


describe("two downloads of one account that overlap", () => {
  // A letterhead names the account, so both statements file their movements under
  // "Up · 700000000" — but each was fingerprinted against its own filename, so the week
  // they share is held twice.
  const shared = { accountId: "Up · 700000000", merchant: "Woolworths Bondi" };
  const may = txn({ ...shared, id: "may", dateIso: "2026-05-15", amount: -86.4 });
  const sept = txn({ ...shared, id: "sept", dateIso: "2026-09-20", amount: -30, merchant: "Coles" });

  function ledgerOf(...uploads: InterpretedTransaction[][]) {
    return uploads.reduce(
      (held, rows) => appendToLedger(held, upload(rows), { importedAt: "2026-09-01T00:00:00.000Z" }).ledger,
      EMPTY_LEDGER,
    );
  }

  it("holds every row, and shows the shared week once", () => {
    const ledger = ledgerOf(
      [{ ...may, sourceFile: "jan-jun.csv" }],
      [
        { ...sept, sourceFile: "may-sep.csv" },
        { ...may, id: "may-again", sourceFile: "may-sep.csv" },
      ],
    );

    assert.equal(ledgerTransactions(ledger).length, 3, "both statements keep the rows they brought");
    assert.equal(visibleTransactions(ledger).length, 2);
    assert.equal(summarizeMoneyFlow(visibleTransactions(ledger)).spending, 116.4);
  });

  it("still counts a purchase a person genuinely made twice in a day", () => {
    const twice = [
      { ...may, sourceFile: "jan-jun.csv" },
      { ...may, id: "may-2", sourceFile: "jan-jun.csv" },
    ];
    const ledger = ledgerOf(twice, [...twice.map((row) => ({ ...row, sourceFile: "may-sep.csv" }))]);

    assert.equal(ledgerTransactions(ledger).length, 4);
    assert.equal(visibleTransactions(ledger).length, 2, "two shops, seen by two statements");
  });

  it("keeps the same shop on the same day in two accounts as two payments", () => {
    const ledger = ledgerOf([
      { ...may, sourceFile: "up.csv" },
      { ...may, id: "nab", accountId: "NAB · 100200300", sourceFile: "nab.csv" },
    ]);

    assert.equal(visibleTransactions(ledger).length, 2);
  });

  it("folds the overlap away once a person says two statements are one account", () => {
    // The same account, exported twice: once with the number printed, once without.
    const held = ledgerOf(
      [{ ...may, sourceFile: "up-number.csv" }],
      [{ ...may, id: "masked", accountId: "Up · ···000", sourceFile: "up-masked.csv" }],
    );

    assert.equal(visibleTransactions(held).length, 2, "two accounts until someone says otherwise");

    const merged = nameAccount(nameAccount(held, "Up · 700000000", "Spending"), "Up · ···000", "Spending");
    assert.equal(visibleTransactions(merged).length, 1);
    assert.equal(ledgerTransactions(merged).length, 2, "naming an account moves no stored row");
  });
});

describe("accumulating a ledger", () => {
  it("adds the movements from a first import", () => {
    const { ledger, report } = appendToLedger(EMPTY_LEDGER, upload([txn(), txn({ id: "b", amount: -9 })]), {
      importedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(ledger.entries.length, 2);
    assert.equal(report.added, 2);
    assert.equal(report.duplicates, 0);
    assert.equal(report.imports[0]?.rows, 2);
  });

  it("keeps genuine same-day repeats of the same purchase", () => {
    const coffee = txn({ description: "Coffee Roasters" });
    const { ledger, report } = appendToLedger(EMPTY_LEDGER, upload([coffee, { ...coffee, id: "b" }]), {
      importedAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(ledger.entries.length, 2);
    assert.equal(report.duplicates, 0);
  });

  it("recognises the same statement uploaded twice", () => {
    const rows = [txn({ accountKey: "100200300" }), txn({ id: "b", amount: -9, accountKey: "100200300" })];
    const first = appendToLedger(EMPTY_LEDGER, upload(rows), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload(rows), { importedAt: "2026-09-02T00:00:00.000Z" });
    assert.equal(second.ledger.entries.length, 2);
    assert.equal(second.report.added, 0);
    assert.equal(second.report.duplicates, 2);
  });

  it("recognises the same file content under a new name", () => {
    const rows = [txn(), txn({ id: "b", amount: -9 })];
    const renamed = rows.map((row) => ({ ...row, sourceFile: "copy.csv" }));
    const first = appendToLedger(EMPTY_LEDGER, upload(rows), {
      importedAt: "2026-09-01T00:00:00.000Z",
      hashes: { "statement.csv": "hash-1" },
    });
    const second = appendToLedger(first.ledger, upload(renamed), {
      importedAt: "2026-09-02T00:00:00.000Z",
      hashes: { "copy.csv": "hash-1" },
    });
    assert.equal(second.ledger.entries.length, 2);
    assert.equal(second.report.added, 0);
    assert.equal(second.report.imports[0]?.repeatOf, first.report.imports[0]?.id);
  });

  it("adds only what is new when two statements overlap", () => {
    const july = txn({ accountKey: "100200300", dateIso: "2026-07-01", description: "Rent" });
    const august = txn({ id: "b", accountKey: "100200300", dateIso: "2026-08-01", description: "Rent" });
    const september = txn({ id: "c", accountKey: "100200300", dateIso: "2026-09-01", description: "Rent" });
    const first = appendToLedger(EMPTY_LEDGER, upload([july, august]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload([august, september]), {
      importedAt: "2026-09-02T00:00:00.000Z",
    });
    assert.equal(second.ledger.entries.length, 3);
    assert.equal(second.report.added, 1);
    assert.equal(second.report.duplicates, 1);
  });

  it("keeps tags the user already set when a later statement repeats a movement", () => {
    const row = txn({ accountKey: "100200300" });
    const first = appendToLedger(EMPTY_LEDGER, upload([row]), { importedAt: "2026-09-01T00:00:00.000Z" });
    first.ledger.entries[0].tags = ["Groceries"];
    const second = appendToLedger(first.ledger, upload([row]), { importedAt: "2026-09-02T00:00:00.000Z" });
    assert.deepEqual(second.ledger.entries[0]?.tags, ["Groceries"]);
  });

  it("removes an import without dropping movements a later import also covers", () => {
    const shared = txn({ accountKey: "100200300" });
    const only = txn({ id: "b", amount: -9, accountKey: "100200300" });
    const first = appendToLedger(EMPTY_LEDGER, upload([shared, only]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload([shared]), { importedAt: "2026-09-02T00:00:00.000Z" });

    const withoutFirst = removeImport(second.ledger, first.report.imports[0].id);
    assert.equal(withoutFirst.entries.length, 1);
    assert.equal(withoutFirst.entries[0]?.amount, -5);
    assert.equal(withoutFirst.imports.length, 1);
  });

  it("lists one row per statement however many times it was uploaded", () => {
    const rows = [txn({ accountKey: "100200300" }), txn({ id: "b", amount: -9, accountKey: "100200300" })];
    const first = appendToLedger(EMPTY_LEDGER, upload(rows), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload(rows), { importedAt: "2026-09-02T00:00:00.000Z" });

    const statements = heldStatements(second.ledger);
    assert.equal(statements.length, 1);
    assert.equal(statements[0]?.uploads, 2);
    assert.equal(statements[0]?.movements, 2);
    assert.equal(statements[0]?.addedAt, "2026-09-01T00:00:00.000Z");
  });

  it("removes a statement along with every upload of it", () => {
    const keep = txn({ sourceFile: "keep.csv", accountKey: "100200300" });
    const drop = txn({ id: "b", amount: -9, sourceFile: "drop.csv", accountKey: "400500600" });
    const first = appendToLedger(EMPTY_LEDGER, upload([keep, drop]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const second = appendToLedger(first.ledger, upload([drop]), { importedAt: "2026-09-02T00:00:00.000Z" });
    assert.equal(heldStatements(second.ledger).find((entry) => entry.key === "drop.csv")?.uploads, 2);

    const without = removeStatement(second.ledger, "drop.csv");
    assert.deepEqual(
      heldStatements(without).map((entry) => entry.key),
      ["keep.csv"],
    );
    assert.equal(without.entries.length, 1);
    assert.equal(without.entries[0]?.sourceFile, "keep.csv");
  });

  it("reads back a stored ledger and rejects junk", () => {
    const { ledger } = appendToLedger(EMPTY_LEDGER, upload([txn()]), { importedAt: "2026-09-01T00:00:00.000Z" });
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));
    assert.equal(restored?.entries.length, 1);
    assert.equal(parseLedger({ entries: "no" }), null);
    assert.equal(parseLedger(null), null);
  });
});

describe("accumulating the NAB statements", () => {
  it("reads both accounts once, however many times they are uploaded", async () => {
    const first = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const once = appendToLedger(EMPTY_LEDGER, first, { importedAt: "2026-09-01T00:00:00.000Z" });
    const before = summarizeMoneyFlow(ledgerTransactions(once.ledger));

    assert.equal(once.report.added, 437);
    assert.equal(before.cashIn, 204214.49);
    assert.equal(before.cashOut, 203665.05);
    assert.equal(before.cashNet, 549.44);

    const again = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const twice = appendToLedger(once.ledger, again, { importedAt: "2026-09-02T00:00:00.000Z" });
    const after = summarizeMoneyFlow(ledgerTransactions(twice.ledger));

    assert.equal(twice.report.added, 0);
    assert.equal(twice.report.duplicates, 437);
    assert.equal(twice.ledger.entries.length, 437);
    assert.equal(after.cashIn, before.cashIn);
    assert.equal(after.cashOut, before.cashOut);
    assert.equal(after.cashNet, before.cashNet);
  });

  it("builds up one account at a time", async () => {
    const rent = await readSamples(["nab-rent.csv"]);
    const step = appendToLedger(EMPTY_LEDGER, rent, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.equal(summarizeMoneyFlow(ledgerTransactions(step.ledger)).cashNet, -3119.58);

    const both = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const full = appendToLedger(step.ledger, both, { importedAt: "2026-09-02T00:00:00.000Z" });
    const flow = summarizeMoneyFlow(ledgerTransactions(full.ledger));

    assert.equal(full.report.added, 378);
    assert.equal(full.report.duplicates, 59);
    assert.equal(flow.cashIn, 204214.49);
    assert.equal(flow.cashOut, 203665.05);
    assert.equal(flow.cashNet, 549.44);
  });

  it("holds statements from two banks side by side", async () => {
    const nab = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const first = appendToLedger(EMPTY_LEDGER, nab, { importedAt: "2026-09-01T00:00:00.000Z" });

    const up = await interpretDocuments(
      [
        {
          filename: "up-2025-07-to-2026-06.txt",
          mime: "text/plain",
          bytes: new Uint8Array(readFileSync(path.join(samples, "up-2025-07-to-2026-06.txt"))),
        },
      ],
      { ai: null },
    );
    const both = appendToLedger(first.ledger, up, { importedAt: "2026-09-02T00:00:00.000Z" });

    assert.equal(both.report.added, up.transactions.length);
    assert.equal(both.report.duplicates, 0);
    assert.equal(both.ledger.entries.length, 437 + up.transactions.length);
    assert.equal(both.ledger.imports.length, 3);
  });

  it("names the account each import covered", async () => {
    const result = await readSamples(["nab-medicare.csv", "nab-rent.csv"]);
    const { report } = appendToLedger(EMPTY_LEDGER, result, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.deepEqual(report.imports.map((entry) => entry.accountKeys), [["acct:100200300"], ["acct:400500600"]]);
    assert.equal(report.imports[0]?.from, "2025-07-01");
  });
});

describe("the Up statement, downloaded twice over overlapping periods", () => {
  // Up prints its account on the letterhead rather than beside every movement, so each
  // export was fingerprinted against its own filename and the months they share are held
  // twice. Nothing stored can be dropped — either statement may be removed later — so the
  // overlap is read past instead.
  async function readText(filename: string, text: string) {
    return interpretDocuments(
      [{ filename, mime: "text/plain", bytes: new TextEncoder().encode(text) }],
      { ai: null },
    );
  }

  it("shows the year the person actually had, not the months counted twice", async () => {
    const whole = readFileSync(path.join(samples, "up-2025-07-to-2026-06.txt"), "utf8");
    const lines = whole.split("\n");
    const letterhead = lines.slice(0, 15);
    const days = lines.flatMap((line, index) =>
      index >= 15 && /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, /.test(line) ? [index] : [],
    );
    // Newest first, so the recent export is the top of the file and the older one the
    // bottom, cut to share 79 days in the middle.
    const recent = [...letterhead, ...lines.slice(15, days[Math.floor(days.length * 0.6)])].join("\n");
    const older = [...letterhead, ...lines.slice(days[Math.floor(days.length * 0.4)])].join("\n");

    let ledger = appendToLedger(EMPTY_LEDGER, await readText("up-jan-to-jun.txt", recent), {
      importedAt: "2026-09-01T00:00:00.000Z",
    }).ledger;
    ledger = appendToLedger(ledger, await readText("up-jul-to-mar.txt", older), {
      importedAt: "2026-09-02T00:00:00.000Z",
    }).ledger;

    const held = ledgerTransactions(ledger);
    const shown = visibleTransactions(ledger);
    assert.equal(held.length, 1549, "every row both statements brought is kept");
    assert.equal(shown.length, 1267);

    // The same figures the app shows when the year is uploaded as one file: the
    // statement's own $70,574.39 and $71,631.34, less the $448.89 of charges that were
    // reversed, which the bank counts as cash both ways but nobody earned or spent.
    // Decided over everything held, the way the app reads it. The Bunnings charge and the
    // refund that reversed it fell either side of the cut, so neither statement could pair
    // them on its own — only the whole ledger can.
    const settle = (rows: InterpretedTransaction[]) => markRefundLegs(markTransferLegs(rows));
    const flow = summarizeMoneyFlow(settle(shown));
    assert.equal(flow.income, 70125.5);
    assert.equal(flow.spending, 71182.45);
    assert.equal(flow.net, -1056.95);

    const doubled = summarizeMoneyFlow(settle(held));
    assert.equal(doubled.income, 94912.46, "what the overlap would otherwise read as");
  });

  it("leaves a year uploaded once exactly as it is", async () => {
    const up = await interpretDocuments(
      [
        {
          filename: "up-2025-07-to-2026-06.txt",
          mime: "text/plain",
          bytes: new Uint8Array(readFileSync(path.join(samples, "up-2025-07-to-2026-06.txt"))),
        },
      ],
      { ai: null },
    );
    const { ledger } = appendToLedger(EMPTY_LEDGER, up, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.equal(visibleTransactions(ledger).length, ledgerTransactions(ledger).length);
  });
});
