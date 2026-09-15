/**
 * Slice 3: Spec 7 Review Queue skeleton.
 *
 * OPEN money-trust items are held out of Income / Spending / Refund credits / Net.
 * Only INGEST_PARSE may be dismissed. RESOLVE writes said pairs so Slice 2
 * forgetAutoPairs cannot strip them, and Spec 10 Actual Savings can fire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forgetAutoPairs } from "./auto-pairs";
import {
  REVIEW_REASONS,
  buildReviewQueue,
  canDismiss,
  confirmRefundPair,
  confirmTransferPair,
  dismissReviewItem,
  moneyTrustHoldIds,
  openReviewCount,
  resolveReviewItem,
} from "./review-queue";
import { summarizeMoneyFlow } from "./summary";
import type { InterpretedTransaction } from "./types";

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  const amount = over.amount;
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? (amount > 0 ? "salary" : "groceries"),
    date: over.dateIso,
    type: over.type ?? (amount > 0 ? "earned" : "spent"),
    sourceFile: over.sourceFile ?? "demo.csv",
    confidence: 1,
    ...over,
  };
}

const out = txn({
  id: "out",
  amount: -400,
  dateIso: "2026-03-12",
  type: "spent",
  accountId: "Up · Spending",
  merchant: "Transfer To Save!!",
  categoryKey: "uncategorised",
  bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
});
const intoSave = txn({
  id: "in-save",
  amount: 400,
  dateIso: "2026-03-12",
  type: "earned",
  accountId: "Up · Save!!",
  merchant: "Transfer From Spending",
  categoryKey: "uncategorised",
  bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
});

describe("Spec 7 closed reason set", () => {
  it("includes the money-trust and ingest reasons Slice 3 named", () => {
    for (const reason of [
      "UNPAIRED_TRANSFER",
      "PARTIAL_REFUND",
      "FULL_REFUND_AMBIGUOUS",
      "DUPLICATE_HOLD",
      "UNREVIEWED_KIND",
      "INGEST_PARSE",
      "FINGERPRINT_CONFLICT",
      "RULE_CONFLICT",
      "AI_LOW_CONFIDENCE",
    ] as const) {
      assert.ok(REVIEW_REASONS.includes(reason), reason);
    }
  });
});

describe("OPEN exclusion", () => {
  it("holds unpaired transfer legs out of Income, Spending and Net, not cash", () => {
    const rows = [out, intoSave];
    const queue = buildReviewQueue(rows);
    assert.ok(queue.some((item) => item.reason === "UNPAIRED_TRANSFER" && item.state === "OPEN"));
    assert.ok(moneyTrustHoldIds(rows).has("out"));
    assert.ok(moneyTrustHoldIds(rows).has("in-save"));

    const flow = summarizeMoneyFlow(rows);
    assert.equal(flow.income, 0, "OPEN credit is not Income");
    assert.equal(flow.spending, 0, "OPEN debit is not Spending");
    assert.equal(flow.refunds, 0);
    assert.equal(flow.net, 0);
    assert.equal(flow.transfers, 0);
    assert.equal(flow.actualSavings, 0);
    assert.equal(flow.cashIn, 400, "cash still ties to the statement");
    assert.equal(flow.cashOut, 400);
  });

  it("holds a refund-shaped credit out of tiles without reducing the original spend", () => {
    const paid = txn({
      id: "paid",
      amount: -80,
      dateIso: "2026-03-03",
      merchant: "Kmart Wagga",
      type: "spent",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
    });
    const back = txn({
      id: "back",
      amount: 80,
      dateIso: "2026-03-04",
      merchant: "Kmart Wagga",
      type: "earned",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
      bank: { type: "Refund" },
      categoryKey: "uncategorised",
    });
    const salary = txn({
      id: "pay",
      amount: 3000,
      dateIso: "2026-03-06",
      merchant: "Acme Payroll",
      type: "earned",
      categoryKey: "salary",
    });

    const flow = summarizeMoneyFlow([paid, back, salary]);
    assert.equal(flow.spending, 80, "month-freeze: original payment stays in Spending");
    assert.equal(flow.income, 3000);
    assert.equal(flow.refunds, 0);
    assert.equal(flow.net, 3000 - 80);
    assert.ok(moneyTrustHoldIds([paid, back, salary]).has("back"));
    assert.ok(!moneyTrustHoldIds([paid, back, salary]).has("paid"));
  });
});

describe("no-dismiss for money-trust", () => {
  it("refuses every reason except INGEST_PARSE", () => {
    for (const reason of REVIEW_REASONS) {
      assert.equal(canDismiss(reason), reason === "INGEST_PARSE");
    }
    const transfer = buildReviewQueue([out, intoSave])[0];
    assert.equal(transfer?.reason, "UNPAIRED_TRANSFER");
    assert.throws(() => dismissReviewItem(transfer!), /INGEST_PARSE/);
  });

  it("can dismiss INGEST_PARSE and then the badge is clear of that item", () => {
    const queue = buildReviewQueue([], {
      files: [
        {
          filename: "blank.csv",
          fileType: "csv",
          kind: "csv",
          uploadStatus: "failed",
          processingStatus: "failed",
          processingError: "The file was empty.",
          transactionCount: 0,
          notes: [],
        },
      ],
    });
    assert.equal(queue[0]?.reason, "INGEST_PARSE");
    assert.equal(openReviewCount(queue), 1);
    const closed = dismissReviewItem(queue[0]!);
    assert.equal(closed.state, "DISMISSED");
    const next = buildReviewQueue([], {
      files: [
        {
          filename: "blank.csv",
          fileType: "csv",
          kind: "csv",
          uploadStatus: "failed",
          processingStatus: "failed",
          processingError: "The file was empty.",
          transactionCount: 0,
          notes: [],
        },
      ],
      stored: [closed],
    });
    assert.equal(openReviewCount(next), 0);
  });
});

describe("RESOLVE transfer writes ledger truth", () => {
  it("leaves Income, cancels both legs, and feeds Actual Savings on Save!!", () => {
    const confirmed = confirmTransferPair([out, intoSave], "out", "in-save");
    assert.equal(confirmed[0]?.transferPair, confirmed[1]?.transferPair);
    assert.equal(confirmed[0]?.decidedBy, "user_overridden");
    assert.equal(confirmed[0]?.type, "TRANSFER");

    const forgotten = forgetAutoPairs(confirmed);
    assert.equal(forgotten[0]?.transferPair, forgotten[1]?.transferPair, "user_overridden pairs survive forgetAutoPairs");

    const flow = summarizeMoneyFlow(forgotten);
    assert.equal(flow.income, 0, "confirmed transfer has left Income");
    assert.equal(flow.spending, 0);
    assert.equal(flow.transfers, 400);
    assert.equal(flow.actualSavings, 400, "CLEARED TRANSFER IN to Save!!");
    assert.equal(openReviewCount(buildReviewQueue(forgotten)), 0);
  });

  it("links a refund onto Refund credits without reducing Spending", () => {
    const paid = txn({
      id: "paid",
      amount: -80,
      dateIso: "2026-03-03",
      merchant: "Kmart Wagga",
      type: "spent",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
    });
    const back = txn({
      id: "back",
      amount: 80,
      dateIso: "2026-03-04",
      merchant: "Kmart Wagga",
      type: "earned",
      accountId: "NAB · 1",
      description: "Kmart Wagga",
      bank: { type: "Refund" },
      categoryKey: "uncategorised",
    });
    const linked = confirmRefundPair([paid, back], "paid", "back");
    const flow = summarizeMoneyFlow(forgetAutoPairs(linked));
    assert.equal(flow.refunds, 80);
    assert.equal(flow.spending, 80);
    assert.equal(flow.income, 0);
    assert.equal(flow.net, 0);
  });

  it("resolveReviewItem is what makes the badge clear", () => {
    const [item] = buildReviewQueue([out, intoSave]);
    assert.equal(openReviewCount([item!]), 1);
    assert.equal(openReviewCount([resolveReviewItem(item!)]), 0);
  });

  it("replays stored OPEN FINGERPRINT_CONFLICT and RULE_CONFLICT onto the queue", () => {
    const stored = [
      {
        id: "FINGERPRINT_CONFLICT:abc",
        reason: "FINGERPRINT_CONFLICT" as const,
        state: "OPEN" as const,
        movementIds: ["a"],
        label: "Guest and account disagree",
      },
      {
        id: "RULE_CONFLICT:cafe",
        reason: "RULE_CONFLICT" as const,
        state: "OPEN" as const,
        movementIds: [],
        label: "Guest and account learned different actions",
      },
    ];
    const queue = buildReviewQueue([], { stored });
    assert.ok(queue.some((item) => item.reason === "FINGERPRINT_CONFLICT" && item.state === "OPEN"));
    assert.ok(queue.some((item) => item.reason === "RULE_CONFLICT" && item.state === "OPEN"));
  });
});
