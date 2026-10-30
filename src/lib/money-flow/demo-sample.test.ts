import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { demoSampleApplies, demoSampleLedger } from "./demo-sample";
import { ledgerTransactions } from "./ledger";
import { needsStarterReset } from "./starter-list";
import { summarizeMoneyFlow } from "./summary";

const NOW = new Date("2026-10-30T00:00:00.000Z");

describe("Demo mode sample", () => {
  it("shows only while signed out with an empty ledger", () => {
    assert.equal(demoSampleApplies({ signedIn: false, imports: 0, entries: 0 }), true);
    assert.equal(demoSampleApplies({ signedIn: true, imports: 0, entries: 0 }), false);
    assert.equal(demoSampleApplies({ signedIn: false, imports: 1, entries: 0 }), false);
    assert.equal(demoSampleApplies({ signedIn: false, imports: 0, entries: 4 }), false);
    assert.equal(demoSampleApplies({ signedIn: false, imports: 0, entries: 0, demoSample: true }), false);
  });

  it("is a labelled Australian month a person can read", () => {
    const ledger = demoSampleLedger(NOW);
    assert.equal(ledger.demoSample, true);
    assert.equal(needsStarterReset(ledger), false);
    assert.equal(ledger.imports[0]?.label, "Sample");
    assert.deepEqual(ledger.imports[0]?.notes, ["Sample"]);

    const merchants = ledger.entries.map((row) => row.merchant);
    for (const name of ["Woolworths", "Coles", "Ampol", "Telstra", "AGL", "Transport for NSW", "Chemist Warehouse"]) {
      assert.ok(merchants.includes(name), name);
    }
    const woolies = ledger.entries.find((row) => row.merchant === "Woolworths");
    assert.equal(woolies?.amount, -86.4);
    assert.equal(woolies?.dateIso, "2026-10-03");

    const flow = summarizeMoneyFlow(ledgerTransactions(ledger));
    assert.equal(flow.income, 4337.55);
    assert.equal(flow.cashIn, 4337.55, "salary, Medicare, and interest; the pocket transfer stays out");
    assert.equal(flow.cashOut, 2624.94);
    assert.equal(flow.categories.some((row) => row.amount > 0), true);

    const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
    assert.match(shell, /Demo mode · Sample/);
  });
});
