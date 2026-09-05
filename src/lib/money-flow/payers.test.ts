import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_LEDGER, parseLedger, recordPayerMerge } from "./ledger";
import { payerGroups, payerSuggestions } from "./payers";
import { incomeRhythms } from "./rhythm";
import type { InterpretedTransaction } from "./types";
import { likeKey, rawLikeKey } from "./verdicts";

let made = 0;

function paid(dateIso: string, amount: number, description: string, accountId = "NAB · 100200300") {
  made += 1;
  return {
    id: `m${made}`,
    merchant: description,
    categoryKey: "uncategorised",
    date: dateIso,
    dateIso,
    amount,
    type: amount > 0 ? "earned" : "spent",
    sourceFile: "nab.csv",
    accountId,
    confidence: 1,
    description,
  } satisfies InterpretedTransaction;
}

function run(startIso: string, count: number, everyDays: number, amount: number, description: string) {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    paid(new Date(start + index * everyDays * 86400000).toISOString().slice(0, 10), amount, description),
  );
}

describe("a payer whose name moves around", () => {
  it("reads one payer however the bank orders the words", () => {
    const atTheEnd = paid("2026-05-08", 297.9, "MC BBS711 1793931J MCARE BENEFITS STEVEN OH");
    const inTheMiddle = paid("2026-05-11", 576.95, "MC BBS712 1793931J STEVEN OH MCARE BENEFITS");

    assert.equal(likeKey(atTheEnd), likeKey(inTheMiddle), "where a name sits is not information");
    assert.equal(payerGroups([atTheEnd, inTheMiddle]).length, 1);
  });

  it("still tells two different payers apart", () => {
    const medicare = paid("2026-05-08", 297.9, "MC BBS711 1793931J MCARE BENEFITS STEVEN OH");
    const veterans = paid("2026-05-08", 41.45, "DV BBE462 1793931J VTA BENEFITS STEVEN OH");

    assert.notEqual(likeKey(medicare), likeKey(veterans));
    assert.equal(payerGroups([medicare, veterans]).length, 2);
  });
});

describe("offering to join two wordings", () => {
  // Medicare pays 20 times with the name and 5 times without it, both spread over enough
  // weeks that each has a rhythm of its own to report.
  const withName = run("2026-01-05", 20, 3, 500, "MC BBS### 1793931J MCARE BENEFITS STEVEN OH");
  const without = run("2026-01-07", 5, 15, 400, "MC BBS### 1793931J MCARE BENEFITS");

  it("spots a name that dropped off the end", () => {
    const [suggestion] = payerSuggestions([...withName, ...without]);

    assert.equal(suggestion.count, 5);
    assert.equal(suggestion.amount, 2000);
    assert.match(suggestion.reason, /without "steven"/);
    assert.equal(suggestion.keep, rawLikeKey(withName[0]), "the wording on the most movements stays");
    assert.equal(suggestion.merge, rawLikeKey(without[0]));
  });

  it("changes nothing until it is taken", () => {
    const rows = [...withName, ...without];
    assert.equal(payerGroups(rows).length, 2);
    assert.equal(new Set(rows.map((row) => likeKey(row))).size, 2);
  });

  it("joins them once it is", () => {
    const rows = [...withName, ...without];
    const payers = { [rawLikeKey(without[0])]: rawLikeKey(withName[0]) };
    assert.equal(new Set(rows.map((row) => likeKey(row, { payers }))).size, 1);
  });

  it("mends the rate a split payer was reporting", () => {
    const rows = [...withName, ...without];
    const before = incomeRhythms(rows, { minPayments: 5 });
    const payers = { [rawLikeKey(without[0])]: rawLikeKey(withName[0]) };
    const after = incomeRhythms(rows, { minPayments: 5, registry: { payers } });

    assert.equal(before.length, 2, "one payer, read as two");
    assert.equal(after.length, 1);
    assert.equal(after[0].count, 25);
    assert.ok(after[0].perWeek > before[0].perWeek, "and the rate is the whole payer's");
  });

  it("refuses when the shared words are the person's own name", () => {
    // "JORDAN LEE" sits inside Medicare's wording, inside the DVA's, and inside every
    // transfer they make. It says nothing about which payer a movement belongs to.
    const rows = [
      ...run("2026-01-05", 20, 3, 500, "MC BBS### MCARE BENEFITS JORDAN LEE"),
      ...run("2026-01-06", 20, 3, 40, "DV BBE### VTA BENEFITS JORDAN LEE"),
      ...run("2026-01-07", 20, 3, 300, "JORDAN LEE K3412561876"),
    ];

    assert.deepEqual(payerSuggestions(rows), [], "words inside more than one payer name none of them");
  });

  it("leaves a single word alone, however well it fits", () => {
    const rows = [
      ...run("2026-01-05", 20, 3, 500, "Osko Payment Received"),
      ...run("2026-01-06", 4, 3, 90, "Payment"),
    ];
    assert.deepEqual(payerSuggestions(rows), []);
  });

  it("never joins money in to money out", () => {
    // Rent received and a management fee paid, worded so one contains the other. Joining
    // them would make one verdict settle both, in opposite directions.
    const rows = [
      ...run("2026-01-05", 20, 3, 2300, "SMITH PROPERTY RENT"),
      ...run("2026-01-06", 20, 3, -180, "SMITH PROPERTY RENT MANAGEMENT FEE"),
    ];
    assert.deepEqual(payerSuggestions(rows), []);
  });

  it("never reaches across accounts", () => {
    const rows = [
      ...run("2026-01-05", 20, 3, 500, "MC BBS### MCARE BENEFITS STEVEN OH"),
      ...run("2026-01-07", 5, 3, 400, "MC BBS### MCARE BENEFITS").map((row) => ({
        ...row,
        accountId: "NAB · 400500600",
      })),
    ];
    assert.deepEqual(payerSuggestions(rows), []);
  });

  it("stops offering one that has been taken", () => {
    const rows = [...withName, ...without];
    const payers = { [rawLikeKey(without[0])]: rawLikeKey(withName[0]) };
    assert.deepEqual(payerSuggestions(rows, { payers }), []);
  });
});

describe("remembering that two wordings are one payer", () => {
  it("keeps it beside the movements, and gives it back on reload", () => {
    const ledger = recordPayerMerge(EMPTY_LEDGER, "like|a", "like|b");
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));
    assert.deepEqual(restored?.payers, { "like|a": "like|b" });
  });

  it("separates them again", () => {
    const joined = recordPayerMerge(EMPTY_LEDGER, "like|a", "like|b");
    assert.deepEqual(recordPayerMerge(joined, "like|a", null).payers, {});
  });

  it("will not join a payer to itself", () => {
    assert.deepEqual(recordPayerMerge(EMPTY_LEDGER, "like|a", "like|a").payers, {});
  });

  it("follows a chain of merges to where it ends", () => {
    const row = paid("2026-05-08", 100, "Third Wording");
    const payers = { [rawLikeKey(row)]: "like|second", "like|second": "like|first" };
    assert.equal(likeKey(row, { payers }), "like|first");
  });

  it("does not hang on a loop somebody stored", () => {
    const row = paid("2026-05-08", 100, "Looping Wording");
    const payers = { [rawLikeKey(row)]: "like|b", "like|b": rawLikeKey(row) };
    assert.equal(typeof likeKey(row, { payers }), "string");
  });

  it("ignores anything stored that is not a pair of wordings", () => {
    const restored = parseLedger({
      entries: [],
      imports: [],
      payers: { good: "like|b", empty: "", bad: 7, worse: null },
    });
    assert.deepEqual(Object.keys(restored?.payers ?? {}), ["good"]);
  });
});
