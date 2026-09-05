import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markRefundLegs, matchRefunds } from "./refunds";
import { summarizeMoneyFlow } from "./summary";
import type { InterpretedTransaction } from "./types";

let made = 0;

function move(
  accountId: string,
  amount: number,
  dateIso: string,
  description: string,
  over: Partial<InterpretedTransaction> = {},
): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant: description,
    categoryKey: "uncategorised",
    date: dateIso,
    dateIso,
    amount,
    // A credit starts as earnings, as every credit does. What makes it worth looking for a
    // reversed payment against is the statement saying so — and saying so is still not
    // believed, because finding the payment is what settles it.
    type: amount < 0 ? "spent" : "earned",
    ...(amount > 0 ? { bank: { type: "Refund" } } : {}),
    sourceFile: `${accountId.split(" · ")[0]}.csv`,
    institution: accountId.split(" · ")[0],
    accountId,
    confidence: 1,
    ...over,
  };
}

/**
 * A ledger's worth of unrelated movements, so a shared word is weighed against a real
 * corpus rather than against three rows. A person's actual ledger runs to thousands.
 */
function filler(): InterpretedTransaction[] {
  return Array.from({ length: 120 }, (_, index) =>
    move("NAB · 100200300", -10 - index, "2026-01-01", `Filler${index} Cafe`),
  );
}

const FILLER_SPENDING = filler().reduce((sum, row) => sum + Math.abs(row.amount), 0);

const ACCOUNT = "NAB · 100200300";

describe("recognising money that came back", () => {
  it("pairs a reversal with the payment it reverses", () => {
    const paid = move(ACCOUNT, -2806.7, "2025-10-15", "TPL97315 The Optical Supe Jordan Lee");
    const back = move(ACCOUNT, 2806.7, "2025-10-16", "REVERSAL OF DEBIT OPTICAL SUPERSTORE PTPL02235");
    const match = matchRefunds([paid, back, ...filler()]);

    assert.equal(match.pairs.length, 1);
    assert.equal(match.pairs[0].because, "optical");
    assert.equal(match.pairs[0].lagDays, 1);
    assert.equal(match.matched.size, 2);
  });

  it("takes both the refund and the payment out of the totals, leaving net alone", () => {
    const rows = markRefundLegs([
      move(ACCOUNT, -100, "2026-03-03", "Domino Pizza"),
      move(ACCOUNT, 100, "2026-03-04", "Domino Pizza"),
      move(ACCOUNT, -40, "2026-03-05", "Woolworths Bondi"),
      move(ACCOUNT, 3000, "2026-03-06", "Acme Payroll", { type: "earned" }),
      ...filler(),
    ]);
    const flow = summarizeMoneyFlow(rows);

    assert.equal(flow.income, 3000, "money handed back is not money earned");
    assert.equal(flow.spending, 40 + FILLER_SPENDING, "the cancelled payment is gone, the filler remains");
    assert.equal(flow.cashIn, 3100, "the cash that actually moved is still reported");
  });

  it("refuses a benefit the bank happens to file under Refund", () => {
    // What NAB does with a practice's Medicare income: 172 credits, all called "Refund".
    const benefits = Array.from({ length: 30 }, (_, index) =>
      move(ACCOUNT, 500, `2026-03-${String(index + 1).padStart(2, "0")}`, `MC BBS${index} MCARE BENEFITS JORDAN LEE`),
    );
    // Debits of the same amount in the same account, sharing only the person's own name.
    const rent = Array.from({ length: 30 }, (_, index) =>
      move(ACCOUNT, -500, `2026-02-${String(index + 1).padStart(2, "0")}`, `RENT PAYMENT JORDAN LEE`),
    );

    const match = matchRefunds([...benefits, ...rent]);
    assert.equal(match.pairs.length, 0, "a surname on every row ties nothing to anything");
    assert.equal(summarizeMoneyFlow(markRefundLegs([...benefits, ...rent])).income, 15000);
  });

  it("will not send money back to an account it never left", () => {
    const match = matchRefunds([
      move(ACCOUNT, -80, "2026-03-03", "Kmart Wagga"),
      move("NAB · 400500600", 80, "2026-03-04", "Kmart Wagga"),
      ...filler(),
    ]);
    assert.equal(match.pairs.length, 0);
  });

  it("refuses a credit that arrived before the payment, and one a year late", () => {
    const early = matchRefunds([
      move(ACCOUNT, -80, "2026-03-04", "Kmart Wagga"),
      move(ACCOUNT, 80, "2026-03-03", "Kmart Wagga"),
      ...filler(),
    ]);
    const late = matchRefunds([
      move(ACCOUNT, -80, "2025-03-03", "Kmart Wagga"),
      move(ACCOUNT, 80, "2026-03-03", "Kmart Wagga"),
      ...filler(),
    ]);

    assert.equal(early.pairs.length, 0);
    assert.equal(late.pairs.length, 0);
  });

  it("wants the same money back, not a similar amount", () => {
    const match = matchRefunds([
      move(ACCOUNT, -80.5, "2026-03-03", "Kmart Wagga"),
      move(ACCOUNT, 80.49, "2026-03-04", "Kmart Wagga"),
      ...filler(),
    ]);
    assert.equal(match.pairs.length, 0);
  });

  it("leaves a transfer's leg alone, having already accounted for it", () => {
    const match = matchRefunds([
      move(ACCOUNT, -500, "2026-03-03", "Osko Kmart Wagga", { transferPair: "a~b" }),
      move(ACCOUNT, 500, "2026-03-04", "Kmart Wagga"),
      ...filler(),
    ]);
    assert.equal(match.pairs.length, 0);
  });

  it("reverses the most recent payment when a shop was paid the same amount twice", () => {
    const older = move(ACCOUNT, -60, "2026-03-01", "Kmart Wagga");
    const newer = move(ACCOUNT, -60, "2026-03-05", "Kmart Wagga");
    const match = matchRefunds([older, newer, move(ACCOUNT, 60, "2026-03-06", "Kmart Wagga"), ...filler()]);

    assert.equal(match.pairs.length, 1);
    assert.equal(match.pairs[0].payment.id, newer.id);
  });

  it("cancels one payment per refund, not the whole run of them", () => {
    const rows = [
      move(ACCOUNT, -60, "2026-03-01", "Kmart Wagga"),
      move(ACCOUNT, -60, "2026-03-02", "Kmart Wagga"),
      move(ACCOUNT, -60, "2026-03-03", "Kmart Wagga"),
      move(ACCOUNT, 60, "2026-03-06", "Kmart Wagga"),
      ...filler(),
    ];
    assert.equal(matchRefunds(rows).pairs.length, 1);
    assert.equal(summarizeMoneyFlow(markRefundLegs(rows)).spending, 120 + FILLER_SPENDING);
  });

  it("reaches the same pairs whatever order the movements arrive in", () => {
    const rows = [
      move(ACCOUNT, -60, "2026-03-01", "Kmart Wagga"),
      move(ACCOUNT, 60, "2026-03-06", "Kmart Wagga"),
      move(ACCOUNT, -25, "2026-04-01", "Bunnings Warehouse"),
      move(ACCOUNT, 25, "2026-04-03", "Bunnings Warehouse"),
      ...filler(),
    ];
    const key = (rows: InterpretedTransaction[]) =>
      rows.filter((row) => row.refundPair).map((row) => `${row.id}:${row.refundPair}`).sort();

    assert.deepEqual(key(markRefundLegs(rows)), key(markRefundLegs([...rows].reverse())));
  });

  it("forgets a pair that no longer holds", () => {
    const stale = move(ACCOUNT, 60, "2026-03-06", "Kmart Wagga", { refundPair: "gone~stale" });
    assert.equal(markRefundLegs([stale, ...filler()])[0].refundPair, undefined);
  });
});

describe("money that only looks like it came back", () => {
  it("leaves two real movements alone when nothing says one reversed the other", () => {
    // A landlord receiving rent and paying the same agent the same amount. Same account,
    // same cent, inside the window, sharing the rare word "smith" — and both real.
    const rows = [
      move(ACCOUNT, 2300, "2026-03-01", "SMITH PROPERTY RENT RECEIVED", { type: "earned" }),
      move(ACCOUNT, -2300, "2026-03-20", "SMITH PROPERTY MANAGEMENT"),
      ...filler(),
    ];
    const flow = summarizeMoneyFlow(markRefundLegs(rows));

    assert.equal(matchRefunds(rows).pairs.length, 0);
    assert.equal(flow.income, 2300, "the rent is still income");
    assert.equal(flow.spending, 2300 + FILLER_SPENDING, "and the fee is still spending");
  });

  it("still takes one the bank marked as a reversal", () => {
    const rows = [
      move(ACCOUNT, -2300, "2026-03-01", "SMITH PROPERTY MANAGEMENT"),
      move(ACCOUNT, 2300, "2026-03-20", "REVERSAL OF DEBIT SMITH PROPERTY", { type: "returned" }),
      ...filler(),
    ];
    assert.equal(matchRefunds(rows).pairs.length, 1);
  });
});
