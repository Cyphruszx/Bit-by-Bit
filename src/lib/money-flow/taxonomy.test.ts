import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { classify } from "./classify";
import { interpretDocuments } from "./interpret";
import { reviewGroups, reviewProgress } from "./review";
import { summarizeMoneyFlow } from "./summary";
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
  held = classify(result.transactions);
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
    assert.equal(drawdown.categoryKey, "debt-payments");
    assert.equal(drawdown.tags?.[0], "Drawdown", "the detail the rule knew, kept as a tag");
    assert.equal(drawdown.type, "DEBT_PRINCIPAL");
    assert.equal(drawdown.bank?.category, "Transfers in");

    // The $24,800 that left the same day is ordinary spending and stays counted. Only the
    // credit was ever wrong.
    const paid = on(rows, "2026-06-30", -24800, /ecom Capital/i);
    assert.equal(paid.type, "UNREVIEWED");
    assert.equal(paid.categoryKey, "uncategorised", "nothing recognises it, and saying so is honest");
  });

  it("reads interest charged and interest earned as opposite things", async () => {
    const rows = await ledger();
    const charged = on(rows, "2026-06-30", -0.61, /Interest Charged/i);
    assert.equal(charged.categoryKey, "bank-fees");
    assert.equal(charged.type, "SPENDING");

    const earned = on(rows, "2026-06-30", 0.1, /^\s*Interest\b/i);
    assert.equal(earned.categoryKey, "other-income");
    assert.equal(earned.type, "INCOME");
  });

  it("reads a government benefit as income, not as an expense category", async () => {
    const rows = await ledger();
    // Filed under Health by the old model: a credit wearing a spending category, which is
    // the mismatch the type layer exists to make impossible.
    const medicare = on(rows, "2026-06-29", 662.4, /MCARE BENEFITS/i);
    assert.equal(medicare.categoryKey, "other-income");
    assert.deepEqual(medicare.tags, ["Rebate"]);
    assert.equal(medicare.type, "INCOME");

    const dva = on(rows, "2026-06-29", 41.45, /VTA BENEFITS/i);
    assert.equal(dva.categoryKey, "other-income");
    assert.equal(dva.type, "INCOME");
  });

  it("recognises the everyday merchants, including the one that used to land in Other", async () => {
    const rows = await ledger();
    assert.equal(on(rows, "2026-06-30", -14.95, /KFC/i).categoryKey, "eating-out");
    assert.equal(on(rows, "2026-06-30", -13, /WOOLWORTHS/i).categoryKey, "groceries");
    assert.equal(on(rows, "2026-06-29", -71.45, /WOOLWORTHS/i).categoryKey, "groceries");
    assert.equal(on(rows, "2026-06-27", -27.9, /Grill/i).categoryKey, "eating-out");
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

  it("does not silently settle a payment to a person against the receipt in another bank", async () => {
    const rows = await ledger();
    const sent = on(rows, "2026-06-30", -200, /JORDAN LEE/i);
    const received = on(rows, "2026-06-30", 200, /Osko Payment Received/i);
    // Spec 7: Core detects the candidate but does not write money-trust. Both legs stay
    // visible until Review Queue confirms them.
    assert.equal(sent.transferPair, undefined);
    assert.equal(received.transferPair, undefined);
    assert.notEqual(sent.type, "TRANSFER");
    assert.notEqual(received.type, "TRANSFER");
  });

  it("asks about a payee once, however many reference numbers the bank stamped on it", async () => {
    const groups = reviewGroups(await ledger());
    const offset = groups.filter((group) => /casey lee offset/i.test(group.merchant));

    // OPEN unpaired offsets leave the merchant queue; Review Queue holds them instead.
    assert.equal(offset.length, 0);
  });

  it("puts the money in front of the person in the order it matters", async () => {
    const rows = await ledger();
    const groups = reviewGroups(rows);
    const progress = reviewProgress(rows);

    // OPEN unpaired transfers leave the counted set, so a larger share is already
    // placed. The merchant seed files more of the long tail (67% of 1303 rows on the
    // three sample statements) without touching Income 145096.99 / Spending 89913.17.
    assert.equal(progress.percent, 67);
    assert.ok(groups.length < 250, `${groups.length} questions, not one per movement`);
    assert.ok(
      Math.abs(groups[0].amount) > Math.abs(groups[groups.length - 1].amount),
      "biggest first",
    );
  });

  it("carries the detail through every reader, as a tag rather than a deeper category", async () => {
    const rows = await ledger();
    const tagged = rows.filter((txn) => (txn.tags ?? []).length > 0);

    // The three statement readers each build their own rows, and a tag wired into one of
    // them reached only that bank's movements — 97 Woolworths shops arrived untagged that
    // way. Two Bakers Delight purchases (NSI bakery → groceries) bring the sample to 99.
    assert.ok(tagged.length > 600, `only ${tagged.length} movements carry a tag`);

    const counted = new Map<string, number>();
    for (const txn of tagged) for (const tag of txn.tags ?? []) counted.set(tag, (counted.get(tag) ?? 0) + 1);
    assert.equal(counted.get("Groceries"), 99);
    assert.equal(counted.get("Restaurants"), 224);
    assert.equal(counted.get("Rebate"), 177);
  });

  it("keeps the household's cash tied to the statements while its income is not", async () => {
    const flow = summarizeMoneyFlow(await ledger());
    // Raw, over all three statements, so the $118,183.87 the person moved between their
    // own accounts is in here twice on purpose — this is the cash that crossed an account
    // boundary, not what the household earned or spent.
    assert.equal(flow.cashIn, 289235.48);
    assert.equal(flow.cashOut, 289742.99);
    assert.equal(flow.cashNet, -507.51, "unchanged by the redesign, because no amount moved");
    // Spec 7: OPEN unpaired transfers are held out of Income/Spending. $25,000 of what
    // arrived was borrowed, so it is in the cash and not in the earnings.
    assert.equal(flow.income, 145096.99);
    assert.equal(flow.spending, 89913.17);
    assert.equal(flow.refunds, 0);
  });
});
