import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstSyncFrom, isPendingBankStatus, parseTransaction } from "./banking";

describe("Fiskil banking mapping", () => {
  it("prefers posted datetime and maps PENDING vs POSTED", () => {
    const pending = parseTransaction({
      id: "tx_p",
      account_id: "acc_1",
      amount: "-4.00",
      description: "Hold",
      status: "PENDING",
      execution: "2026-09-18T10:00:00.000Z",
    });
    assert.equal(pending?.status, "PENDING");
    assert.equal(pending?.dateIso, "2026-09-18");
    assert.equal(isPendingBankStatus("PENDING"), true);

    const posted = parseTransaction({
      id: "tx_c",
      account_id: "acc_1",
      amount: 12,
      type: "DEBIT",
      description: "Shop",
      status: "POSTED",
      posted: "2026-09-19T03:00:00.000Z",
      execution: "2026-09-18T10:00:00.000Z",
    });
    assert.equal(posted?.status, "POSTED");
    assert.equal(posted?.dateIso, "2026-09-19");
    assert.equal(posted?.amount, -12);
  });

  it("first-sync window is 90 days", () => {
    const from = firstSyncFrom(Date.parse("2026-09-19T00:00:00.000Z"));
    assert.equal(from.startsWith("2026-06-21"), true);
  });
});
