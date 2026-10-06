/**
 * Spec 2A.8 regression locks L1–L12, read from public/samples (2026-09 set).
 * A drift in these figures fails the build. L5 and L6 are observed file facts
 * with no ledger-amount lock. The Up saver-transfer rule (2A.9) is not applied.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { appendToLedger, EMPTY_LEDGER } from "./ledger";
import { interpretDocuments } from "./interpret";
import { buildReviewQueue } from "./review-queue";
import { sourceValue } from "./source";
import { accountBalanceView, fileIndexOf, mostRecentStatedBalances, NO_BANK_BALANCE_LABEL } from "./statement-balance";
import { summarizeMoneyFlow } from "./summary";
import type { InterpretedTransaction } from "./types";

process.env.OPENAI_API_KEY = "";

const samples = path.join(process.cwd(), "public/samples");
const UP = "up-spending-2026-09.csv";
const NAB_1541 = "nab-x1541-2026-09.csv";
const NAB_5479 = "nab-x5479-2026-09.csv";

function load(name: string) {
  return {
    filename: name,
    mime: "text/csv",
    bytes: new Uint8Array(readFileSync(path.join(samples, name))),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function bankType(txn: InterpretedTransaction): string {
  return txn.bank?.type ?? sourceValue(txn.source, "Transaction Type");
}

/** Newest-first NAB export: previous balance + amount = this balance, oldest first. */
function oldestFirst(rows: InterpretedTransaction[]): InterpretedTransaction[] {
  return [...rows].sort((a, b) => fileIndexOf(b) - fileIndexOf(a));
}

function openingFromWalk(rows: InterpretedTransaction[]): number {
  const oldest = oldestFirst(rows)[0];
  const balance = Number(sourceValue(oldest?.source, "Balance"));
  const amount = Number(sourceValue(oldest?.source, "Amount"));
  return round2(balance - amount);
}

function balanceBreaks(rows: InterpretedTransaction[]): number {
  const ordered = oldestFirst(rows);
  let breaks = 0;
  let previous: number | null = null;
  for (const row of ordered) {
    const balance = Number(sourceValue(row.source, "Balance"));
    const amount = Number(sourceValue(row.source, "Amount"));
    if (previous == null) previous = round2(balance - amount);
    const expected = round2(previous + amount);
    if (expected !== round2(balance)) breaks += 1;
    previous = balance;
  }
  return breaks;
}

describe("2026-09 sample locks (2A.8 L1–L12)", () => {
  it("reads the three CSVs to the locked figures", async () => {
    const result = await interpretDocuments([load(UP), load(NAB_1541), load(NAB_5479)]);
    const up = result.transactions.filter((txn) => txn.sourceFile === UP);
    const nab1541 = result.transactions.filter((txn) => txn.sourceFile === NAB_1541);
    const nab5479 = result.transactions.filter((txn) => txn.sourceFile === NAB_5479);

    const upNames: Record<string, number> = {};
    for (const txn of up) {
      const name = sourceValue(txn.source, "Account Name");
      upNames[name] = (upNames[name] ?? 0) + 1;
    }
    assert.equal(up.length, 308, "L1");
    assert.equal(upNames.Spending, 300, "L1");
    assert.equal(upNames["📈 Investing"], 8, "L1");
    assert.equal(result.files.find((file) => file.filename === UP)?.processingError, undefined);

    const upFlow = summarizeMoneyFlow(up);
    assert.equal(upFlow.cashIn, 15409.86, "L2 money in");
    assert.equal(upFlow.cashOut, 12969.81, "L2 money out");

    const transfers = up.filter((txn) => bankType(txn) === "Transfer");
    assert.equal(transfers.length, 56, "L3");
    assert.equal(transfers.filter((txn) => txn.type === "TRANSFER").length, 56, "L3");
    const transferIn = round2(transfers.filter((txn) => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0));
    const transferOut = round2(transfers.filter((txn) => txn.amount < 0).reduce((sum, txn) => sum + txn.amount, 0));
    assert.equal(transfers.filter((txn) => txn.amount > 0).length, 23, "L3");
    assert.equal(transfers.filter((txn) => txn.amount < 0).length, 33, "L3");
    assert.equal(transferIn, 2201, "L3");
    assert.equal(transferOut, -5764.93, "L3");
    const upWithout = summarizeMoneyFlow(up.filter((txn) => txn.type !== "TRANSFER"));
    assert.equal(upFlow.cashIn, upWithout.cashIn, "L3 transfers stay out of money in");
    assert.equal(upFlow.cashOut, upWithout.cashOut, "L3 transfers stay out of money out");
    assert.equal(upFlow.income, upWithout.income, "L3 transfers stay out of income");
    assert.equal(upFlow.spending, upWithout.spending, "L3 transfers stay out of spending");

    assert.deepEqual(mostRecentStatedBalances(up), {}, "L4 no balance column");
    assert.equal(up.every((txn) => sourceValue(txn.source, "Balance") === ""), true);
    const upIds = [...new Set(up.map((txn) => txn.accountId))];
    assert.deepEqual(upIds.sort(), ["Up · 633-123 / 05", "Up · 633-123 / 172365082"]);
    for (const id of upIds) {
      const view = accountBalanceView(id ?? "", up.filter((txn) => txn.accountId === id));
      assert.equal(view.label, NO_BANK_BALANCE_LABEL, "L4");
      assert.equal(view.amount, null, "L4");
    }
    const saverPayees = ["CashFlow", "Emergency Fund", "Essentials", "Presents", "Tax", "Investing"];
    for (const payee of saverPayees) {
      assert.equal(
        up.some((txn) => txn.accountId?.toLowerCase().includes(payee.toLowerCase())),
        false,
        `L4 no saver account created from payee ${payee}`,
      );
    }

    const upText = readFileSync(path.join(samples, UP), "utf8");
    const lines = upText.trim().split(/\r?\n/).slice(1);
    let roundUps = 0;
    let roundUpTotal = 0;
    let usd = 0;
    const header = upText.split(/\r?\n/)[0]?.replace(/^\uFEFF/, "").split(",") ?? [];
    const subIdx = header.indexOf("Subtotal (AUD)");
    const totalIdx = header.indexOf("Total (AUD)");
    const roundIdx = header.indexOf("Round Up (AUD)");
    const currencyIdx = header.indexOf("Currency");
    for (const line of lines) {
      const cells = parseCsvLine(line);
      if (cells[subIdx] !== cells[totalIdx]) roundUps += 1;
      roundUpTotal += Number(cells[roundIdx] ?? 0);
      if (cells[currencyIdx] === "USD") usd += 1;
    }
    assert.equal(roundUps, 84, "L5 observed");
    assert.equal(round2(roundUpTotal), 31, "L5 observed");
    assert.equal(usd, 2, "L6 observed");

    assert.equal(nab1541.length, 7, "L7");
    assert.equal(openingFromWalk(nab1541), 0.49, "L7 opening");
    assert.equal(balanceBreaks(nab1541), 0, "L7");
    assert.equal(mostRecentStatedBalances(nab1541)["NAB · 861631541"], 1.54, "L7");
    const { ledger } = appendToLedger(EMPTY_LEDGER, { ...result, transactions: nab1541 }, {
      importedAt: "2026-09-22T00:00:00.000Z",
    });
    assert.equal(ledger.accountMeta?.["NAB · 861631541"]?.clearedBalance, 1.54, "L7");

    assert.equal(nab5479.length, 84, "L8");
    assert.equal(openingFromWalk(nab5479), 1289.52, "L8 opening");
    assert.equal(balanceBreaks(nab5479), 0, "L8");
    assert.equal(mostRecentStatedBalances(nab5479)["NAB · 970375479"], 3320.05, "L8");

    const pairs = [
      { amount: 3100, date: "2026-08-06" },
      { amount: 262.53, date: "2026-08-17" },
      { amount: 2012.71, date: "2026-09-14" },
    ];
    const nab = [...nab1541, ...nab5479];
    for (const pair of pairs) {
      const legs = nab.filter((txn) => txn.dateIso === pair.date && Math.abs(txn.amount) === pair.amount);
      assert.equal(legs.length, 2, `L9 ${pair.amount}`);
      assert.ok(legs.every((txn) => txn.type === "TRANSFER" && txn.transferPair), `L9 ${pair.amount}`);
      assert.equal(new Set(legs.map((txn) => txn.transferPair)).size, 1);
    }
    const queue = buildReviewQueue(nab);
    const pairedIds = new Set(
      nab.filter((txn) => pairs.some((pair) => txn.dateIso === pair.date && Math.abs(txn.amount) === pair.amount)).map((txn) => txn.id),
    );
    assert.equal(
      queue.some(
        (item) =>
          item.state === "OPEN" &&
          item.reason === "UNPAIRED_TRANSFER" &&
          item.movementIds.some((id) => pairedIds.has(id)),
      ),
      false,
      "L9 no OPEN UNPAIRED_TRANSFER on the three legs",
    );

    const medicare = nab5479.filter(
      (txn) =>
        bankType(txn) === "INTER-BANK CREDIT" &&
        sourceValue(txn.source, "Merchant Name") === "Medicare" &&
        sourceValue(txn.source, "Category") === "Refund",
    );
    assert.equal(medicare.length, 33, "L10");
    for (const txn of medicare) {
      assert.equal(txn.bank?.category, "Refund");
      assert.notEqual(txn.cdrType, "REFUND", "L10 category cell does not set cdr_type");
      assert.ok(txn.cdrType == null || txn.cdrType === "OTHER", "L10 INTER-BANK CREDIT stays OTHER");
      assert.notEqual(txn.type, "TRANSFER");
      assert.notEqual(txn.decidedBy, "bank", "L10 category cell is not the decision");
    }

    const drawings = nab.filter((txn) => bankType(txn) === "AUTOMATIC DRAWING");
    const misc = nab.filter((txn) => bankType(txn) === "MISCELLANEOUS DEBIT");
    assert.equal(drawings.length, 6, "L11");
    assert.equal(nab1541.filter((txn) => bankType(txn) === "AUTOMATIC DRAWING").length, 2, "L11");
    assert.equal(nab5479.filter((txn) => bankType(txn) === "AUTOMATIC DRAWING").length, 4, "L11");
    assert.equal(misc.length, 1, "L11");
    const plain = drawings.filter((txn) => !/societyone/i.test(`${txn.merchant} ${txn.description ?? ""}`));
    assert.equal(plain.length, 2, "L11");
    assert.ok(plain.every((txn) => txn.type === "UNREVIEWED"), "L11 AUTOMATIC DRAWING stays unsorted");
    assert.equal(misc[0]?.bank?.type, "MISCELLANEOUS DEBIT");
    assert.notEqual(misc[0]?.type, "TRANSFER", "L11");

    const society = drawings.filter((txn) => /societyone/i.test(`${txn.merchant} ${txn.description ?? ""}`));
    assert.equal(society.length, 4, "L12");
    assert.ok(
      society.every((txn) => txn.amount === -237.06 && txn.type === "DEBT_PRINCIPAL"),
      "L12",
    );
  });
});

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}
