import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incomeSources, unsettledIncome } from "./income";
import { EMPTY_LEDGER, parseLedger, recordVerdict } from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import type { InterpretedTransaction } from "./types";
import { applyVerdicts, countLike, likeKey, oneKey, reasonsFor, verdictFor } from "./verdicts";

let made = 0;

function credit(amount: number, description: string, over: Partial<InterpretedTransaction> = {}) {
  made += 1;
  return {
    id: `m${made}`,
    merchant: description,
    category: "Other",
    date: "1 Jun",
    dateIso: "2026-06-01",
    amount,
    type: amount > 0 ? "transfer" : "expense",
    sourceFile: "nab.csv",
    accountId: "NAB · 100200300",
    confidence: 1,
    description,
    ...over,
  } satisfies InterpretedTransaction;
}

const AT = "2026-09-03T00:00:00.000Z";

describe("settling what the statements cannot say", () => {
  it("takes borrowed money out of income, leaving the cash where it is", () => {
    const loan = credit(25000, "SOC-10000000001CT SocietyOne");
    const rows = [loan, credit(3000, "Acme Payroll", { type: "income" })];
    const settled = applyVerdicts(rows, { [oneKey(loan)]: verdictFor("borrowed", AT) });
    const flow = summarizeMoneyFlow(settled);

    assert.equal(flow.income, 3000, "a loan is not money the household earned");
    assert.equal(flow.cashIn, 28000, "the cash still arrived, and the statement still says so");
    assert.equal(flow.net, 3000);
  });

  it("settles every movement that reads the same way, in one go", () => {
    const benefits = Array.from({ length: 172 }, (_, index) =>
      credit(500, "MC BBS 5550001X MCARE BENEFITS JORDAN LEE", {
        dateIso: `2026-0${(index % 9) + 1}-01`,
        type: "refund",
      }),
    );

    assert.equal(countLike(benefits[0], benefits), 172, "one verdict, not 172");
    const settled = applyVerdicts(benefits, { [likeKey(benefits[0])]: verdictFor("earned", AT) });
    assert.equal(settled.every((row) => row.verdict?.counts === true), true);
    // Confirming earnings changes no total, it only stops the app asking.
    assert.equal(summarizeMoneyFlow(settled).income, 86000);
    assert.equal(unsettledIncome(settled), 0);
    assert.deepEqual(incomeSources(settled).map((source) => source.kind), ["earned"]);
  });

  it("reads the reference numbers past, so one wording covers the run", () => {
    // The same benefit, paid twice, written with a different reference each time.
    const first = credit(500, "MC BBS878 5550001X MCARE BENEFITS JORDAN LEE");
    const second = credit(500, "MC BBS370 5550001X MCARE BENEFITS JORDAN LEE", { dateIso: "2026-07-01" });

    assert.equal(likeKey(first), likeKey(second), "one rule covers the run");
    assert.notEqual(oneKey(first), oneKey(second), "and the rows are still told apart by when");
  });

  it("keeps a rule off movements it was never about", () => {
    const benefit = credit(500, "MCARE BENEFITS JORDAN LEE");
    const wages = credit(500, "Acme Payroll", { type: "income" });
    const away = credit(-500, "MCARE BENEFITS JORDAN LEE");
    const other = credit(500, "MCARE BENEFITS JORDAN LEE", { accountId: "NAB · 400500600" });

    const settled = applyVerdicts([benefit, wages, away, other], {
      [likeKey(benefit)]: verdictFor("earned", AT),
    });
    assert.deepEqual(settled.map((row) => Boolean(row.verdict)), [true, false, false, false]);
  });

  it("lets a verdict on one row beat a rule about all of them", () => {
    const one = credit(500, "Osko Payment Received");
    const rest = credit(500, "Osko Payment Received", { dateIso: "2026-07-01" });
    const settled = applyVerdicts([one, rest], {
      [likeKey(one)]: verdictFor("own-account", AT),
      [oneKey(one)]: verdictFor("earned", AT),
    });

    assert.equal(settled[0].verdict?.because, "earned");
    assert.equal(settled[1].verdict?.because, "own-account");
    assert.equal(summarizeMoneyFlow(settled).income, 500);
  });

  it("gives back the whole figure when a verdict is taken away", () => {
    const loan = credit(25000, "SocietyOne Drawdown");
    const settled = applyVerdicts([loan], { [oneKey(loan)]: verdictFor("borrowed", AT) });
    assert.equal(summarizeMoneyFlow(settled).income, 0);
    assert.equal(summarizeMoneyFlow(applyVerdicts(settled, {})).income, 25000);
    assert.equal(applyVerdicts(settled, {})[0].verdict, undefined);
  });

  it("offers a person only the reasons that could apply", () => {
    assert.deepEqual(
      reasonsFor(500).map((choice) => choice.reason),
      ["earned", "money-back", "own-account", "borrowed"],
    );
    assert.deepEqual(reasonsFor(-500).map((choice) => choice.reason), ["spent", "not-mine"]);
  });

  it("takes a payment out of spending when it went to an account not uploaded", () => {
    const offset = credit(-5000, "CASEY LEE OFFSET T9236586400");
    const rows = [offset, credit(-40, "Woolworths Bondi")];
    const flow = summarizeMoneyFlow(applyVerdicts(rows, { [oneKey(offset)]: verdictFor("not-mine", AT) }));

    assert.equal(flow.spending, 40);
    assert.equal(flow.cashOut, 5040);
  });
});

describe("remembering a verdict", () => {
  it("keeps it beside the movements, and gives it back on reload", () => {
    const loan = credit(25000, "SocietyOne");
    const ledger = recordVerdict(EMPTY_LEDGER, oneKey(loan), verdictFor("borrowed", AT));
    const restored = parseLedger(JSON.parse(JSON.stringify(ledger)));

    assert.deepEqual(restored?.verdicts, { [oneKey(loan)]: { counts: false, because: "borrowed", at: AT } });
    assert.equal(applyVerdicts([loan], restored?.verdicts)[0].verdict?.counts, false);
  });

  it("takes one back without disturbing the others", () => {
    const a = recordVerdict(EMPTY_LEDGER, "one|a", verdictFor("borrowed", AT));
    const b = recordVerdict(a, "one|b", verdictFor("earned", AT));
    assert.deepEqual(Object.keys(recordVerdict(b, "one|a", null).verdicts ?? {}), ["one|b"]);
  });

  it("ignores anything stored that does not read as a verdict", () => {
    const restored = parseLedger({
      entries: [],
      imports: [],
      verdicts: { good: { counts: false, because: "borrowed", at: AT }, bad: "yes", worse: null },
    });
    assert.deepEqual(Object.keys(restored?.verdicts ?? {}), ["good"]);
  });
});
