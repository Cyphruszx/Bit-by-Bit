import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confidenceNeededFor } from "./ai";
import { personalWords, redactDescriptor, redactMovement } from "./redact";
import { reviewGroups, reviewProgress, unsortedMovements } from "./review";
import type { InterpretedTransaction } from "./types";

let made = 0;

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant: "Paypal",
    categoryKey: "uncategorised",
    decidedBy: "unreviewed",
    date: "30 Jun",
    dateIso: "2026-06-30",
    amount: -37.99,
    type: "spent",
    sourceFile: "up.txt",
    confidence: 0.9,
    ...over,
  };
}

describe("the review queue", () => {
  it("asks once per merchant rather than once per movement", () => {
    const groups = reviewGroups([txn(), txn(), txn({ merchant: "Kfc", amount: -14.95 })]);
    assert.deepEqual(
      groups.map((group) => [group.merchant, group.count]),
      [
        ["Paypal", 2],
        ["Kfc", 1],
      ],
    );
  });

  it("puts the most money first, not the most movements", () => {
    // One $24,800 payment matters more to the reports than forty coffees, and it is the
    // same single click to answer.
    const groups = reviewGroups([
      ...Array.from({ length: 40 }, () => txn({ merchant: "Cafe", amount: -5 })),
      txn({ merchant: "Ecom Capital Pty Ltd", amount: -24800 }),
    ]);
    // Labelled by the payee rather than by how one row wrote it, so "Pty Ltd" and any
    // reference number the bank stamped on come off.
    assert.equal(groups[0].merchant, "Ecom Capital");
    assert.equal(groups[1].count, 40);
  });

  it("says whether the money came in or went out", () => {
    const [group] = reviewGroups([txn({ merchant: "Mystery", amount: 500 })]);
    assert.equal(group.amount, 500);
    assert.equal(group.from, "2026-06-30");
  });

  it("leaves out anything already settled, because no figure is reading it", () => {
    // A transfer's two legs and a reversed payment are in no total, so asking what they
    // were for would be asking a person to tidy something nothing looks at.
    const rows = [
      txn({ id: "a", transferPair: "a~b", type: "moved" }),
      txn({ id: "b", transferPair: "a~b", type: "moved", amount: 37.99 }),
      txn({ id: "c", merchant: "Kfc" }),
    ];
    assert.deepEqual(unsortedMovements(rows).map((row) => row.id), ["c"]);
  });

  it("leaves out what has a category already", () => {
    assert.deepEqual(reviewGroups([txn({ categoryKey: "food.restaurants", decidedBy: "rules" })]), []);
  });

  it("counts progress by what is done, not by what is left", () => {
    // A first import is mostly unplaced, and a screen that opens on "412 to go" reads as
    // a bill rather than as something a couple of minutes fixes.
    const progress = reviewProgress([
      txn({ categoryKey: "food.groceries", decidedBy: "rules" }),
      txn({ categoryKey: "food.groceries", decidedBy: "rules" }),
      txn({ merchant: "Kfc", amount: -20 }),
    ]);
    assert.deepEqual([progress.sorted, progress.total, progress.percent, progress.unsorted], [2, 3, 67, 20]);
  });

  it("says an empty ledger is finished rather than nought per cent", () => {
    assert.equal(reviewProgress([]).percent, 100);
  });
});

describe("what leaves for a model", () => {
  it("drops account fragments and reference numbers with the tokens carrying them", () => {
    assert.equal(redactDescriptor("Jordan Lee H4756108521"), "jordan lee");
    assert.equal(redactDescriptor("Online C1828652469 Linked Acc Trns Lee Jl"), "linked acc trns lee jl");
    assert.equal(redactDescriptor("Unidentified Paypal *Google Not9,4000000000"), "unidentified paypal google not");
  });

  it("drops the name that turns up all over the ledger, keeping the shop", () => {
    // Worked out from the ledger rather than from a list of names, because holding a list
    // of the person's names is the thing being avoided.
    //
    // Proportioned like the real statements, where "jordan" is on 20% of rows and
    // "woolworths" on 5%, either side of the measured gap.
    const ledger = [
      ...Array.from({ length: 20 }, () => txn({ merchant: "Mcare Benefits Jordan Lee", amount: 662.4 })),
      ...Array.from({ length: 5 }, () => txn({ merchant: "Woolworths Wagga" })),
      ...Array.from({ length: 75 }, (_, index) => txn({ merchant: `Shop${index}` })),
    ];
    const personal = personalWords(ledger);

    assert.ok(personal.has("jordan"), "a name on a fifth of the rows is the account holder");
    assert.ok(!personal.has("woolworths"), "a shop on a twentieth of them is a shop");
    assert.equal(redactMovement(txn({ merchant: "Woolworths Wagga" }), personal), "woolworths wagga");
  });

  it("sends nothing at all for a row that is only words found everywhere", () => {
    // A practice billing the same benefit every week puts "mcare" on 10% of the ledger,
    // which is over the line, so the whole descriptor redacts away and no question is
    // asked. That is the safe direction to be wrong in — and those rows are the ones the
    // person settles outright anyway, which is cheaper than any model call.
    const ledger = Array.from({ length: 20 }, () => txn({ merchant: "Mcare Benefits Jordan Lee", amount: 662.4 }));
    const personal = personalWords([...ledger, ...Array.from({ length: 80 }, (_, i) => txn({ merchant: `Shop${i}` }))]);
    assert.equal(redactMovement(ledger[0], personal), "");
  });

  it("judges nothing personal in a ledger too small to judge", () => {
    // Eight per cent of six movements is half a movement, so on a small ledger every word
    // would look like a name and nothing would ever be sent.
    const personal = personalWords([txn({ merchant: "Woolworths" }), txn({ merchant: "Woolworths" })]);
    assert.equal(personal.size, 0);
  });

  it("says nothing at all when nothing recognisable survives", () => {
    // A descriptor that was only a reference number leaves no question worth asking.
    assert.equal(redactDescriptor("4000000000 1828652469"), "");
  });
});

describe("how sure a model has to be", () => {
  it("asks for more certainty as more money rides on it", () => {
    assert.equal(confidenceNeededFor(-13), 0.55);
    assert.equal(confidenceNeededFor(-250), 0.7);
    assert.equal(confidenceNeededFor(-24800), 0.85);
    assert.equal(confidenceNeededFor(24800), 0.85, "direction does not change what is at stake");
  });
});
