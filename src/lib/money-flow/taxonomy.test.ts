import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { interpretDocuments } from "./interpret";
import { markRefundLegs } from "./refunds";
import { summarizeMoneyFlow } from "./summary";
import { markTransferLegs } from "./transfers";
import type { InterpretedTransaction } from "./types";

process.env.OPENAI_API_KEY = "";

const samples = path.join(process.cwd(), "public/samples");
const NAMES = ["nab-medicare.csv", "nab-rent.csv", "up-2025-07-to-2026-06.txt"];

let held: InterpretedTransaction[] | null = null;

async function ledger(): Promise<InterpretedTransaction[]> {
  if (held) return held;
  const result = await interpretDocuments(
    NAMES.map((filename) => ({
      filename,
      mime: filename.endsWith(".csv") ? "text/csv" : "text/plain",
      bytes: new Uint8Array(readFileSync(path.join(samples, filename))),
    })),
  );
  held = markRefundLegs(markTransferLegs(result.transactions));
  return held;
}

function on(rows: InterpretedTransaction[], dateIso: string, amount: number, wording: RegExp) {
  const found = rows.filter(
    (txn) => txn.dateIso === dateIso && txn.amount === amount && wording.test(`${txn.description ?? ""} ${txn.merchant}`),
  );
  assert.equal(found.length, 1, `expected one movement matching ${wording} on ${dateIso} for ${amount}`);
  return found[0];
}

/**
 * The fifteen movements a redesign has to survive, taken from the sample statements rather
 * than invented, with what each one is and what it was for.
 *
 * Every one of them was classified wrongly by the flat thirteen-tag model, and the four
 * that mattered were wrong in ways that moved a figure: a lender's $25,000 counted as
 * income, a Medicare benefit filed under an expense category, interest charged and
 * interest earned split across two buckets neither of which was right.
 */
describe("the movements the taxonomy has to get right", () => {
  it("does not count a lender's drawdown as income, or the payment it funded as anything else", async () => {
    const rows = await ledger();
    const drawdown = on(rows, "2026-06-30", 25000, /SocietyOne/i);
    assert.equal(drawdown.categoryKey, "debt.drawdown");
    assert.equal(drawdown.type, "borrowed");
    assert.equal(drawdown.bank?.category, "Transfers in");

    // The $24,800 that left the same day is ordinary spending and stays counted. Only the
    // credit was ever wrong.
    const paid = on(rows, "2026-06-30", -24800, /ecom Capital/i);
    assert.equal(paid.type, "spent");
    assert.equal(paid.categoryKey, "uncategorised", "nothing recognises it, and saying so is honest");
  });

  it("reads interest charged and interest earned as opposite things", async () => {
    const rows = await ledger();
    const charged = on(rows, "2026-06-30", -0.61, /Interest Charged/i);
    assert.equal(charged.categoryKey, "money.interest-charged");
    assert.equal(charged.type, "spent");

    const earned = on(rows, "2026-06-30", 0.1, /^\s*Interest\b/i);
    assert.equal(earned.categoryKey, "income.interest");
    assert.equal(earned.type, "earned");
  });

  it("reads a government benefit as income, not as an expense category", async () => {
    const rows = await ledger();
    // Filed under Health by the old model: a credit wearing a spending category, which is
    // the mismatch the type layer exists to make impossible.
    const medicare = on(rows, "2026-06-29", 662.4, /MCARE BENEFITS/i);
    assert.equal(medicare.categoryKey, "income.rebate");
    assert.equal(medicare.type, "earned");

    const dva = on(rows, "2026-06-29", 41.45, /VTA BENEFITS/i);
    assert.equal(dva.categoryKey, "income.government-benefit");
    assert.equal(dva.type, "earned");
  });

  it("recognises the everyday merchants, including the one that used to land in Other", async () => {
    const rows = await ledger();
    assert.equal(on(rows, "2026-06-30", -14.95, /KFC/i).categoryKey, "food.restaurants");
    assert.equal(on(rows, "2026-06-30", -13, /WOOLWORTHS/i).categoryKey, "food.groceries");
    assert.equal(on(rows, "2026-06-29", -71.45, /WOOLWORTHS/i).categoryKey, "food.groceries");
    assert.equal(on(rows, "2026-06-27", -27.9, /Grill/i).categoryKey, "food.restaurants");
  });

  it("leaves a processor's charge unsorted rather than guessing at the seller", async () => {
    const rows = await ledger();
    // PayPal is the processor, not the shop. Two different charges, and nothing in either
    // says what was bought — so both wait to be looked at instead of being filed as one.
    for (const [dateIso, amount] of [["2026-06-30", -37.99], ["2026-06-27", -37.25]] as const) {
      const row = on(rows, dateIso, amount, /paypal/i);
      assert.equal(row.categoryKey, "uncategorised");
      assert.equal(row.decidedBy, "unreviewed");
    }
  });

  it("settles a payment to a person against the receipt in another bank", async () => {
    const rows = await ledger();
    const sent = on(rows, "2026-06-30", -200, /JORDAN LEE/i);
    const received = on(rows, "2026-06-30", 200, /Osko Payment Received/i);
    // Found, not believed: the two legs are the same money on the same day in two accounts
    // the person holds. The old model called the debit "Goals" and the credit "Income",
    // which is $200 of spending and $200 of earnings that never happened.
    assert.equal(sent.type, "moved");
    assert.equal(received.type, "moved");
    assert.equal(sent.transferPair, received.transferPair);
  });

  it("keeps the household's cash tied to the statements while its income is not", async () => {
    const flow = summarizeMoneyFlow(await ledger());
    // Raw, over all three statements, so the $118,183.87 the person moved between their
    // own accounts is in here twice on purpose — this is the cash that crossed an account
    // boundary, not what the household earned or spent.
    assert.equal(flow.cashIn, 289235.48);
    assert.equal(flow.cashOut, 289742.99);
    assert.equal(flow.cashNet, -507.51, "unchanged by the redesign, because no amount moved");
    // $25,000 of what arrived was borrowed, so it is in the cash and not in the earnings.
    assert.equal(flow.income, 142796.02);
    assert.equal(flow.spending, 168303.53);
  });
});
