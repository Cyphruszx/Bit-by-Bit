import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { interpretDocuments } from "./interpret";
import { appendToLedger, EMPTY_LEDGER } from "./ledger";
import { summarizeMoneyFlow } from "./summary";
import {
  derivedMovementBalance,
  mostRecentStatedBalances,
  pickMostRecentStatedBalance,
  statedBalanceFromSource,
} from "./statement-balance";
import type { InterpretedTransaction } from "./types";

const samples = path.join(process.cwd(), "public/samples");

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    merchant: "Cafe",
    categoryKey: "groceries",
    date: over.dateIso,
    type: over.type ?? (over.amount > 0 ? "earned" : "spent"),
    sourceFile: "demo.csv",
    confidence: 1,
    ...over,
  };
}

describe("stated statement balances", () => {
  it("reads the Balance cell and ignores Net", () => {
    const row = txn({
      id: "1",
      amount: 25000,
      dateIso: "2026-06-30",
      source: { headers: ["Amount", "Balance"], values: ["25000.00", "4913.07"] },
    });
    assert.equal(statedBalanceFromSource(row), 4913.07);
    assert.notEqual(statedBalanceFromSource(row), row.amount);
  });

  it("takes the most recent row on a newest-first NAB-style file", () => {
    assert.equal(
      pickMostRecentStatedBalance([
        { dateIso: "2026-06-30", index: 0, amount: 4913.07 },
        { dateIso: "2026-06-30", index: 1, amount: -20086.93 },
        { dateIso: "2026-06-29", index: 2, amount: 4871.62 },
      ]),
      4913.07,
    );
  });

  it("takes the last row of the latest date on an oldest-first file", () => {
    assert.equal(
      pickMostRecentStatedBalance([
        { dateIso: "2026-06-01", index: 0, amount: 10 },
        { dateIso: "2026-06-30", index: 1, amount: 20 },
        { dateIso: "2026-06-30", index: 2, amount: 30 },
      ]),
      30,
    );
  });

  it("derives credits minus debits when no stated balance exists, excluding PENDING", () => {
    const rows = [
      txn({ id: "in", amount: 100, dateIso: "2026-06-01", type: "earned", categoryKey: "salary" }),
      txn({ id: "out", amount: -40, dateIso: "2026-06-02" }),
      txn({ id: "pending", amount: -80, dateIso: "2026-06-03", status: "PENDING" }),
    ];
    assert.equal(derivedMovementBalance(rows), 60);
    assert.notEqual(derivedMovementBalance(rows), summarizeMoneyFlow(rows).net);
  });
});

describe("NAB sample stated balances", () => {
  it("stores the most recent Balance cell on the ledger, not cashNet or Net", async () => {
    const result = await interpretDocuments([
      {
        filename: "nab-medicare.csv",
        mime: "text/csv",
        bytes: readFileSync(path.join(samples, "nab-medicare.csv")),
      },
      {
        filename: "nab-rent.csv",
        mime: "text/csv",
        bytes: readFileSync(path.join(samples, "nab-rent.csv")),
      },
    ]);
    const stated = mostRecentStatedBalances(result.transactions);
    assert.equal(stated["NAB · 100200300"], 4913.07);
    assert.equal(stated["NAB · 400500600"], 0.49);
    assert.notEqual(stated["NAB · 100200300"], result.flow.net);
    assert.notEqual(stated["NAB · 100200300"], result.flow.cashNet);
    assert.equal(result.flow.cashNet, 549.44);

    const { ledger } = appendToLedger(EMPTY_LEDGER, result, { importedAt: "2026-09-01T00:00:00.000Z" });
    assert.equal(ledger.accountMeta?.["NAB · 100200300"]?.clearedBalance, 4913.07);
    assert.equal(ledger.accountMeta?.["NAB · 400500600"]?.clearedBalance, 0.49);
    assert.notEqual(4913.07 + 0.49, result.flow.net);
  });
});
