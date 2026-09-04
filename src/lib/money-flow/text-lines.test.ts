import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transactionsFromText } from "./text-lines";

/**
 * A NAB transaction listing, in the shape a PDF leaves once it is flattened to text. The
 * printed table has Debits, Credits and Balance columns, but flattening keeps only the
 * figures, so a row reads the same whether the money came or went. Rows within a day come
 * out in whatever order the PDF happens to hold them, which is not the order they
 * happened — 11 May below is deliberately scrambled.
 *
 * Figures are invented. A real statement is never committed.
 */
const NAB_LISTING = `Transaction Listing
Date Created: Sep 04, 2026 10:52:45 AM
Account Balance Summary
Opening Balance $2,970.61 CR
Total Credits $1,957.65
Total Debits $1,100.00
Closing Balance $3,828.26 CR
Transaction Listing starts 08 May 2026
Transaction Listing ends 13 May 2026
Account Details
Account Type Transaction Account
BSB Number 085-221
Account Number 97-037-5479
Transaction Details
Date Particulars Debits Credits Balance
08 May 26 MC BBS711 MCARE BENEFITS STEVEN OH $297.90 $3,268.51 CR
11 May 26 STEVEN OH K7614608614 $300.00 $3,928.36 CR
11 May 26 MC BBS712 MCARE BENEFITS STEVEN OH $959.85 $4,228.36 CR
11 May 26 STEVEN OH H2184088682 $600.00 $3,328.36 CR
12 May 26 MC BBS713 MCARE BENEFITS STEVEN OH $661.80 $3,990.16 CR
13 May 26 STEVEN OH F9328622326 $200.00 $3,790.16 CR
13 May 26 MC BBS714 MCARE BENEFITS STEVEN OH $38.10 $3,828.26 CR`;

describe("reading a statement that carries a running balance", () => {
  const rows = transactionsFromText(NAB_LISTING, "nab.pdf");

  it("takes the movement, not the balance beside it", () => {
    assert.equal(rows[0].dateIso, "2026-05-08");
    assert.equal(rows[0].amount, 297.9, "$297.90 moved; $3,268.51 is what was left");
    assert.match(rows[0].merchant, /Mcare Benefits/i);
  });

  it("tells money out from money in, which the columns no longer say", () => {
    const byAmount = new Map(rows.map((row) => [row.amount, row]));
    assert.equal(byAmount.get(959.85)?.amount, 959.85, "a benefit is money in");
    assert.ok(byAmount.has(-300), "a payment out is money out");
    assert.ok(byAmount.has(-600));
    assert.ok(byAmount.has(-200));
  });

  it("settles a day whose rows came out in the wrong order", () => {
    // On 11 May the balance ran 3,268.51 -> 4,228.36 -> 3,928.36 -> 3,328.36, which is
    // not the order the lines are written in.
    const eleventh = rows.filter((row) => row.dateIso === "2026-05-11");
    assert.deepEqual(eleventh.map((row) => row.amount).sort((a, b) => a - b), [-600, -300, 959.85]);
  });

  it("agrees with the statement's own summary, which is what makes it trustworthy", () => {
    const inbound = rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
    const outbound = rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);

    assert.equal(Math.round(inbound * 100) / 100, 1957.65, "the statement's Total Credits");
    assert.equal(Math.round(outbound * 100) / 100, 1100, "the statement's Total Debits");
    assert.equal(Math.round((2970.61 + inbound - outbound) * 100) / 100, 3828.26, "its Closing Balance");
  });

  it("says it is sure, because the statement checked its working", () => {
    assert.ok(rows.every((row) => row.confidence > 0.9));
  });

  it("does not read the summary as things that happened", () => {
    assert.equal(rows.length, 7, "seven movements, not the totals printed above them");
    assert.equal(
      rows.some((row) => /total (debits|credits)|opening|closing|listing/i.test(row.merchant)),
      false,
    );
    // The totals would otherwise land on the day the statement was printed.
    assert.equal(rows.some((row) => row.dateIso === "2026-09-04"), false);
  });
});

describe("reading a statement with no balance to check against", () => {
  // Without a balance the only thing saying which way money went is the line itself, so
  // an export that marks its debits is read on those marks.
  const MARKED = `Statement
12 Mar 2026 Woolworths Bondi $86.40 DR
14 Mar 2026 Salary from Acme $3,200.00 CR
16 Mar 2026 Refund from Kmart $24.50 CR`;

  it("falls back to what the line itself marks, and says it is less sure", () => {
    const rows = transactionsFromText(MARKED, "statement.txt");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].amount, -86.4, "a debit is money out");
    assert.equal(rows[1].amount, 3200);
    assert.equal(rows[2].amount, 24.5, "a refund is money coming back");
    assert.ok(rows.every((row) => row.confidence < 0.9));
  });

  it("keeps its nerve when a balance chain does not add up", () => {
    // Two figures a row, but the second is not a running balance of the first.
    const nonsense = `Date Item Cost Units
12 Mar 2026 Widgets $86.40 $12.00
14 Mar 2026 Sprockets $3,200.00 $40.00
16 Mar 2026 Cogs $24.50 $9.00`;
    const rows = transactionsFromText(nonsense, "parts.csv");
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.confidence < 0.9));
  });
});

describe("a balance column the chain cannot close", () => {
  // A page break dropped a row, so the balances no longer join up.
  const BROKEN = `Statement
Opening Balance $1,000.00 CR
Date Particulars Debits Credits Balance
12 Mar 2026 Woolworths Bondi $100.00 $900.00 CR
14 Mar 2026 Coles Wagga $50.00 $850.00 CR
16 Mar 2026 Salary from Acme $500.00 $9,999.99 CR
18 Mar 2026 Kmart Wagga $25.00 $1,875.00 CR`;

  it("never reads the balance as the money that moved", () => {
    const rows = transactionsFromText(BROKEN, "broken.pdf");
    assert.ok(rows.every((row) => Math.abs(row.amount) < 1000), "no balance became an amount");
    assert.ok(rows.every((row) => row.confidence < 0.9), "and none claims the chain closed");
  });

  it("still reads every row the surviving balances can settle", () => {
    const rows = transactionsFromText(BROKEN, "broken.pdf");
    // $100 was spent at Woolworths. The $900 beside it is what was left.
    assert.equal(rows[0].amount, -100);
    assert.equal(rows[1].amount, -50);
    assert.equal(rows[0].confidence, 0.8, "one neighbouring balance, not a whole chain");
    // The row after the corrupted balance has nothing sound to lean on, so it falls back
    // to its wording and says so.
    assert.equal(rows[3].confidence, 0.64);
  });
});

describe("a statement that never prints its opening balance", () => {
  const NO_OPENING = `Statement
Date Particulars Debits Credits Balance
12 Mar 2026 Woolworths Bondi $100.00 $900.00 CR
14 Mar 2026 Coles Wagga $50.00 $850.00 CR
16 Mar 2026 Kmart Wagga $25.00 $825.00 CR`;

  it("will not guess where the chain starts", () => {
    // Guessing cannot work: both guesses agree on every row but the first, and the closing
    // balance cannot tell them apart because a chain always lands on its own last balance.
    // Guessing made the first movement of every such statement read as money in.
    const rows = transactionsFromText(NO_OPENING, "no-opening.pdf");
    assert.ok(rows.every((row) => row.confidence < 0.9));
  });

  it("still settles every row that has a balance before it", () => {
    const rows = transactionsFromText(NO_OPENING, "no-opening.pdf");
    assert.equal(rows[1].amount, -50, "900 down to 850 is money out");
    assert.equal(rows[2].amount, -25);
    assert.equal(rows[0].confidence, 0.64, "the first row has nothing before it");
  });
});
