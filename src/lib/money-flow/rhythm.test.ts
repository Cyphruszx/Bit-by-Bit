import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { interpretDocuments } from "./interpret";
import { incomeRhythms, weeksWorth } from "./rhythm";
import { markTransferLegs } from "./transfers";
import type { InterpretedTransaction } from "./types";

let made = 0;

function paid(
  dateIso: string,
  amount: number,
  description: string,
  over: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant: description,
    category: "Other",
    date: dateIso,
    dateIso,
    amount,
    type: amount > 0 ? "income" : "expense",
    sourceFile: "nab.csv",
    accountId: "NAB · 100200300",
    confidence: 1,
    description,
    ...over,
  };
}

/** A stream paying every `everyDays` from `startIso`, for `count` payments. */
function run(startIso: string, count: number, everyDays: number, amount: number, description: string) {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    paid(new Date(start + index * everyDays * 86400000).toISOString().slice(0, 10), amount, description),
  );
}

describe("what a stream of money is worth a week", () => {
  it("measures a weekly wage at what it actually pays", () => {
    const [rhythm] = incomeRhythms(run("2026-01-05", 20, 7, 1000, "Acme Payroll"));

    assert.equal(rhythm.count, 20);
    assert.equal(rhythm.everyDays, 7);
    assert.equal(rhythm.perWeek, 1052.63, "19 gaps of a week carry 20 payments");
    assert.equal(rhythm.perFortnight, 2105.26);
  });

  it("ignores a stream too short to have a habit", () => {
    assert.deepEqual(incomeRhythms(run("2026-01-05", 6, 7, 1000, "Acme Payroll")), []);
    // Enough payments, but all in a fortnight, so there is no rhythm to speak of.
    assert.deepEqual(incomeRhythms(run("2026-01-05", 12, 1, 1000, "Acme Payroll")), []);
  });

  it("leaves money that was only moving between accounts out of it", () => {
    const legs = run("2026-01-05", 20, 7, 1000, "Linked Acc Trns").map((row) => ({
      ...row,
      transferPair: `${row.id}~other`,
    }));
    assert.deepEqual(incomeRhythms(legs), []);
  });
});

describe("a stream that stops", () => {
  // $500 every second day, four weeks off in the middle, then the same again. The last
  // payment before the silence is 18 Dec and the first after it 15 Jan: 28 days.
  const before = run("2025-10-01", 40, 2, 500, "MCARE BENEFITS JORDAN LEE");
  const after = run("2026-01-15", 40, 2, 500, "MCARE BENEFITS JORDAN LEE");
  const spending = [paid("2025-12-25", -120, "Qantas"), paid("2026-01-02", -80, "Woolworths")];

  it("finds the silence and says what it was worth", () => {
    const [rhythm] = incomeRhythms([...before, ...after, ...spending]);

    assert.equal(rhythm.breaks.length, 1);
    assert.equal(rhythm.breaks[0].after, "2025-12-18");
    assert.equal(rhythm.breaks[0].until, "2026-01-15");
    assert.equal(rhythm.breaks[0].days, 28);
    // Four weeks of silence at $1,772.23 a week, less the two days that were only the
    // ordinary wait between payments.
    assert.equal(rhythm.breaks[0].worth, 6582.27);
  });

  it("does not let the silence make the stream look smaller than it is", () => {
    const [withBreak] = incomeRhythms([...before, ...after, ...spending]);
    const [unbroken] = incomeRhythms(run("2025-10-01", 80, 2, 500, "MCARE BENEFITS JORDAN LEE"));

    // A month off does not make a practice smaller: both bill $500 every second day, so
    // both should read the same rate to the cent.
    assert.equal(withBreak.perWeek, unbroken.perWeek);
  });

  it("reads a stream stopping while its account carries on as a pause in the work", () => {
    const [rhythm] = incomeRhythms([...before, ...after, ...spending]);
    assert.equal(rhythm.breaks[0].accountKeptMoving, true);
    assert.equal(rhythm.breaks[0].reading, "paused");
  });

  it("reads a whole account falling silent as a statement that may be missing", () => {
    // Nothing at all happens in this account through the silence, while another account
    // carries on spending. That is a hole in the documents, not a hole in the year.
    const otherAccount = [
      paid("2025-12-25", -120, "Qantas", { accountId: "Up · Spending" }),
      paid("2026-01-02", -80, "Woolworths", { accountId: "Up · Spending" }),
    ];
    const [rhythm] = incomeRhythms([...before, ...after, ...otherAccount]);

    assert.equal(rhythm.breaks[0].accountKeptMoving, false);
    assert.equal(rhythm.breaks[0].reading, "may-be-missing");
  });

  it("says nothing about a silence it has nothing to compare against", () => {
    // One account uploaded and no other. Every holiday would otherwise be reported as a
    // missing statement, which is worse than saying nothing.
    const [rhythm] = incomeRhythms([...before, ...after]);
    assert.equal(rhythm.breaks[0].accountKeptMoving, false);
    assert.equal(rhythm.breaks[0].reading, "paused");
  });

  it("does not call a monthly payment's ordinary month a break", () => {
    const [rhythm] = incomeRhythms(run("2025-07-01", 12, 31, 250, "Rent from tenant"));
    assert.equal(rhythm.everyDays, 31);
    assert.deepEqual(rhythm.breaks, [], "a fortnight of silence is nothing to a monthly payment");
  });

  it("still catches a monthly payment that misses a quarter", () => {
    const [rhythm] = incomeRhythms([
      ...run("2025-01-01", 6, 31, 250, "Rent from tenant"),
      ...run("2026-01-01", 6, 31, 250, "Rent from tenant"),
    ]);
    assert.equal(rhythm.breaks.length, 1);
    assert.ok(rhythm.breaks[0].days > 155, `${rhythm.breaks[0].days} days`);
  });
});

describe("the samples, and the question that started this", () => {
  it("reads a year of Medicare billing as a rate a person can check", async () => {
    const dir = path.join(process.cwd(), "public/samples");
    const names = ["nab-medicare.csv", "nab-rent.csv", "up-2025-07-to-2026-06.txt"];
    const result = await interpretDocuments(
      names.map((filename) => ({
        filename,
        mime: filename.endsWith(".csv") ? "text/csv" : "text/plain",
        bytes: new Uint8Array(readFileSync(path.join(dir, filename))),
      })),
      { ai: null },
    );
    const rhythms = incomeRhythms(markTransferLegs(result.transactions));
    const medicare = rhythms.find((rhythm) => /MCARE/i.test(rhythm.label));

    assert.equal(medicare?.count, 172);
    assert.equal(medicare?.everyDays, 1, "Medicare pays most days");
    assert.equal(medicare?.perWeek, 2635.23);
    assert.equal(medicare?.perFortnight, 5270.46);

    // Both silences found, and both read as the work pausing: the account kept spending
    // through them, which is what tells a holiday from a statement with pages missing.
    assert.equal(medicare?.breaks.length, 2);
    assert.deepEqual(
      medicare?.breaks.map((found) => [found.after, found.until, found.reading]),
      [
        ["2025-09-08", "2025-09-23", "paused"],
        ["2026-01-22", "2026-02-20", "paused"],
      ],
    );

    // The whole point: a figure nobody can check becomes one anybody can.
    assert.equal(weeksWorth(medicare!, 5409.1), 2.05);
  });

  it("says nothing about the monthly pennies of interest", async () => {
    const dir = path.join(process.cwd(), "public/samples");
    const result = await interpretDocuments(
      [
        {
          filename: "nab-rent.csv",
          mime: "text/csv",
          bytes: new Uint8Array(readFileSync(path.join(dir, "nab-rent.csv"))),
        },
      ],
      { ai: null },
    );
    const interest = incomeRhythms(result.transactions).find((rhythm) => /INTEREST/i.test(rhythm.label));

    assert.equal(interest?.everyDays, 30);
    assert.deepEqual(interest?.breaks, [], "a month between monthly payments is not a break");
  });
});
