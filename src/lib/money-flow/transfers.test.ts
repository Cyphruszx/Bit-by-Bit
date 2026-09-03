import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessDaysBetween, matchTransfers, withoutMatchedLegs } from "./transfers";
import type { InterpretedTransaction } from "./types";

let made = 0;

function move(
  accountId: string,
  amount: number,
  dateIso: string,
  over: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  made += 1;
  const institution = accountId.split(" · ")[0];
  return {
    id: `m${made}`,
    merchant: amount < 0 ? "Payment" : "Deposit",
    category: "Other",
    date: dateIso,
    dateIso,
    amount,
    type: amount < 0 ? "expense" : "income",
    sourceFile: `${institution}.csv`,
    institution,
    accountId,
    confidence: 1,
    ...over,
  };
}

describe("matching a transfer's two legs", () => {
  it("pairs a debit with the same money arriving in another account", () => {
    const match = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-01"),
      move("NAB · 400500600", 500, "2026-06-01"),
    ]);

    assert.equal(match.pairs.length, 1);
    assert.equal(match.pairs[0].fromAccount, "NAB · 100200300");
    assert.equal(match.pairs[0].toAccount, "NAB · 400500600");
    assert.equal(match.pairs[0].sameInstitution, true);
    assert.equal(match.matched.size, 2);
  });

  it("will not pair money with itself inside one account", () => {
    const match = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-01"),
      move("NAB · 100200300", 500, "2026-06-01"),
    ]);

    assert.equal(match.pairs.length, 0);
  });

  it("refuses a credit that arrived before the debit that caused it", () => {
    const match = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-09"),
      move("Up · Spending", 500, "2026-06-08"),
    ]);

    assert.equal(match.pairs.length, 0);
  });

  it("lets money take longer between banks than inside one", () => {
    const acrossBanks = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-08"),
      move("Up · Spending", 500, "2026-06-10"),
    ]);
    const withinBank = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-08"),
      move("NAB · 400500600", 500, "2026-06-10"),
    ]);

    assert.equal(acrossBanks.pairs.length, 1);
    assert.equal(withinBank.pairs.length, 0, "two days is beyond one bank's own window");
  });

  it("counts a Friday payment landing Monday as one working day, not three", () => {
    assert.equal(businessDaysBetween("2026-06-05", "2026-06-08"), 1);
    assert.equal(businessDaysBetween("2026-06-05", "2026-06-06"), 0);

    const match = matchTransfers([
      move("NAB · 100200300", -500, "2026-06-05"),
      move("NAB · 400500600", 500, "2026-06-08"),
    ]);
    assert.equal(match.pairs.length, 1);
  });

  it("prefers the credit nearest in time, counting the days a bank actually posted", () => {
    const sameDay = move("Up · Spending", 500, "2026-06-05");
    const nextDay = move("Up · Savings", 500, "2026-06-06");
    const match = matchTransfers([move("NAB · 100200300", -500, "2026-06-05"), nextDay, sameDay]);

    assert.equal(match.pairs.length, 1);
    assert.equal(match.pairs[0].credit.id, sameDay.id);
    assert.equal(match.pairs[0].lagDays, 0);
  });

  it("pairs candidates a person could not tell apart either, rather than refusing", () => {
    const match = matchTransfers([
      move("NAB · 100200300", -100, "2026-06-01", { description: "JORDAN LEE A1" }),
      move("NAB · 100200300", -100, "2026-06-01", { description: "JORDAN LEE B2" }),
      move("Up · Spending", 100, "2026-06-01", { description: "Osko Payment Received" }),
      move("Up · Spending", 100, "2026-06-01", { description: "Osko Payment Received" }),
    ]);

    assert.equal(match.pairs.length, 2);
    assert.equal(match.contested.length, 0);
  });

  it("asks rather than guesses when the candidates genuinely differ", () => {
    const match = matchTransfers([
      move("NAB · 100200300", -2000, "2026-06-01", { description: "JORDAN LEE T5" }),
      move("Up · Spending", 2000, "2026-06-01", { description: "Osko Payment Received" }),
      move("Up · Spending", 2000, "2026-06-01", { description: "Wages" }),
    ]);

    assert.equal(match.pairs.length, 0);
    assert.equal(match.contested.length, 1);
    assert.equal(match.contested[0].candidates.length, 2);
  });

  it("lets a credit that names the account settle a tie", () => {
    const fromSaver = move("Up · Spending", 2000, "2026-06-01", { description: "Transfer From Save" });
    const match = matchTransfers([
      move("Up · Save", -2000, "2026-06-01", { description: "Transfer to Spending" }),
      move("NAB · 100200300", -2000, "2026-06-01", { description: "JORDAN LEE T5" }),
      fromSaver,
      move("Up · Spending", 2000, "2026-06-01", { description: "Osko Payment Received" }),
    ]);

    assert.equal(match.contested.length, 0);
    assert.equal(match.pairs.length, 2);
    const saverLeg = match.pairs.find((pair) => pair.fromAccount === "Up · Save");
    assert.equal(saverLeg?.credit.id, fromSaver.id, "the saver's own leg takes the credit naming it");
  });

  it("reaches the same pairs whatever order the movements arrive in", () => {
    const rows = [
      move("NAB · 100200300", -500, "2026-06-01"),
      move("Up · Spending", 500, "2026-06-02"),
      move("NAB · 400500600", -80, "2026-06-03"),
      move("NAB · 100200300", 80, "2026-06-03"),
    ];
    const forwards = matchTransfers(rows);
    const backwards = matchTransfers([...rows].reverse());
    const key = (pairs: typeof forwards.pairs) =>
      pairs.map((pair) => `${pair.debit.id}->${pair.credit.id}`).sort();

    assert.deepEqual(key(forwards.pairs), key(backwards.pairs));
  });

  it("leaves everything that is not a matched leg", () => {
    const groceries = move("NAB · 100200300", -86.4, "2026-06-01");
    const match = matchTransfers([
      groceries,
      move("NAB · 100200300", -500, "2026-06-01"),
      move("Up · Spending", 500, "2026-06-01"),
    ]);

    assert.deepEqual(withoutMatchedLegs([groceries, ...match.pairs.flatMap((p) => [p.debit, p.credit])], match), [
      groceries,
    ]);
  });
});
