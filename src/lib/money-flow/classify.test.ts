import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify, needsReview, outranks } from "./classify";
import { forget, learn, ruleFor, ruleKeyFor, whatWasLearned, type Rules } from "./rules";
import type { InterpretedTransaction } from "./types";

let made = 0;

function txn(over: Partial<InterpretedTransaction> = {}): InterpretedTransaction {
  made += 1;
  return {
    id: `m${made}`,
    merchant: "Kfc",
    categoryKey: "uncategorised",
    decidedBy: "unreviewed",
    date: "30 Jun",
    dateIso: "2026-06-30",
    amount: -14.95,
    type: "spent",
    sourceFile: "up.txt",
    confidence: 0.9,
    ...over,
  };
}

describe("the order the app is allowed to decide", () => {
  it("puts what the person said above everything below it", () => {
    for (const rung of ["learned", "paired", "merchant", "rules", "bank", "ai", "unreviewed"] as const) {
      assert.ok(outranks("said", rung), `said should beat ${rung}`);
      assert.ok(!outranks(rung, "said"), `${rung} should not beat said`);
    }
  });

  it("puts a proved pair above a guess about words", () => {
    // Two legs of the same amount in two accounts is arithmetic. "Woolworths is usually
    // groceries" is not, however often it happens to be right.
    assert.ok(outranks("paired", "merchant"));
    assert.ok(outranks("paired", "rules"));
    assert.ok(!outranks("paired", "learned"));
  });

  it("treats a rung as not beating itself, so nothing rewrites itself forever", () => {
    assert.ok(!outranks("rules", "rules"));
  });

  it("counts a movement with no category as one still to be looked at", () => {
    assert.ok(needsReview(txn()));
    assert.ok(!needsReview(txn({ categoryKey: "eating-out" })));
    // Other was chosen on purpose and is not a question.
    assert.ok(!needsReview(txn({ categoryKey: "other" })));
  });
});

describe("learning from a correction", () => {
  it("remembers a merchant, whatever case the statement wrote it in", () => {
    const rules = learn({}, txn(), "eating-out", "2026-07-01T00:00:00.000Z");
    assert.equal(ruleFor(rules, txn({ merchant: "KFC" }))?.categoryKey, "eating-out");
    assert.equal(ruleFor(rules, txn({ merchant: "  kfc " }))?.categoryKey, "eating-out");
    assert.equal(ruleFor(rules, txn({ merchant: "Kmart" })), undefined);
  });

  it("refuses to remember a category the taxonomy has never heard of", () => {
    // A rule that cannot be applied is worse than none: it would sit in the learned list
    // claiming to be doing something.
    assert.deepEqual(learn({}, txn(), "not-a-real-key", "2026-07-01T00:00:00.000Z"), {});
  });

  it("keeps what it changed, so the list can say what it learned", () => {
    const rules = learn({}, txn({ categoryKey: "shopping" }), "eating-out", "2026-07-01T00:00:00.000Z");
    assert.equal(rules[ruleKeyFor(txn())].from, "shopping");
  });

  it("lets a correction be taken back", () => {
    const rules = learn({}, txn(), "eating-out", "2026-07-01T00:00:00.000Z");
    assert.deepEqual(forget(rules, ruleKeyFor(txn())), {});
    assert.deepEqual(forget(rules, "never-learned"), rules, "forgetting nothing changes nothing");
  });

  it("reads back as sentences, commonest first, with what each one is holding", () => {
    const rules: Rules = {
      ...learn({}, txn(), "entertainment", "2026-07-01T00:00:00.000Z"),
      ...learn({}, txn({ merchant: "Woolworths" }), "eating-out", "2026-07-02T00:00:00.000Z"),
    };
    const rows = [txn(), txn({ merchant: "Woolworths" }), txn({ merchant: "Woolworths" })];
    const learnt = whatWasLearned(rules, rows);

    assert.deepEqual(
      learnt.map((thing) => [thing.sentence, thing.count]),
      [
        ["Woolworths is Food · Eating Out", 2],
        ["Kfc is Lifestyle · Entertainment", 1],
      ],
    );
  });

  it("still lists a correction with nothing behind it yet", () => {
    // It is in force for the next import, and a person deserves to see the thing that will
    // act on their statements before it does.
    const rules = learn({}, txn({ merchant: "Bunnings" }), "shopping", "2026-07-01T00:00:00.000Z");
    assert.deepEqual(whatWasLearned(rules, []).map((thing) => [thing.merchant, thing.count]), [["bunnings", 0]]);
  });
});

describe("walking the ladder", () => {
  it("applies a correction to every movement of that merchant", () => {
    const rules = learn({}, txn(), "eating-out", "2026-07-01T00:00:00.000Z");
    const rows = classify([txn(), txn({ id: "later", dateIso: "2026-08-02" })], { rules });

    for (const row of rows) {
      assert.equal(row.categoryKey, "eating-out");
      assert.equal(row.decidedBy, "learned");
      assert.equal(row.type, "spent");
    }
  });

  it("never re-decides a movement the person settled themselves", () => {
    const rules = learn({}, txn(), "eating-out", "2026-07-01T00:00:00.000Z");
    const chosen = txn({ categoryKey: "entertainment", decidedBy: "said" });
    assert.deepEqual(classify([chosen], { rules }), [chosen]);
  });

  it("beats the rules table, because a person outranks a regex", () => {
    const rules = learn({}, txn(), "entertainment", "2026-07-01T00:00:00.000Z");
    const guessed = txn({ categoryKey: "eating-out", decidedBy: "rules" });
    assert.equal(classify([guessed], { rules })[0].categoryKey, "entertainment");
  });

  it("carries a correction across from a movement the person settled, with no rule stored", () => {
    // The rule store is the durable record; this is the ledger agreeing with it, and is
    // what catches a correction made on another device or before rules were remembered.
    const rows = classify([
      txn({ id: "chosen", categoryKey: "eating-out", decidedBy: "said" }),
      txn({ id: "other" }),
    ]);
    assert.equal(rows[1].categoryKey, "eating-out");
    assert.equal(rows[1].decidedBy, "merchant");
  });

  it("re-derives the type from the category and the direction", () => {
    const rules = learn({}, txn({ merchant: "Ato" }), "other-income", "2026-07-01T00:00:00.000Z");
    const credit = classify([txn({ merchant: "Ato", amount: 1067, type: "spent" })], { rules })[0];
    assert.equal(credit.type, "earned");
  });

  it("reaches the same answer run twice, so importing again changes nothing", () => {
    const rules = learn({}, txn(), "eating-out", "2026-07-01T00:00:00.000Z");
    const once = classify([txn(), txn({ merchant: "Woolworths" })], { rules });
    assert.deepEqual(classify(once, { rules }), once);
  });
});
