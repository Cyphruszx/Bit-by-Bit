import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterReviewItems,
  hasOpenTransferItems,
  keepAsMoneyLabel,
  last30DaysSince,
  openActionsAreUseful,
  reviewNavBadgeCount,
  reviewOpenedOn,
  reviewOpenActions,
  similarOpenUnpaired,
  unpairedAsTransferReason,
  unpairedSettleTargets,
  unpairedSimilarityKey,
} from "./review-page";
import { dismissReviewItem, resolveReviewItem, REVIEW_REASONS, type ReviewItem } from "./review-queue";
import type { InterpretedTransaction } from "./types";

function item(over: Partial<ReviewItem> & Pick<ReviewItem, "id" | "reason">): ReviewItem {
  return {
    state: "OPEN",
    movementIds: over.movementIds ?? [],
    label: over.label ?? over.reason,
    ...over,
  };
}

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? "groceries",
    date: over.dateIso,
    type: over.type ?? (over.amount > 0 ? "earned" : "spent"),
    sourceFile: over.sourceFile ?? "demo.csv",
    confidence: 1,
    ...over,
  };
}

const openTransfer = item({
  id: "UNPAIRED_TRANSFER:out~in",
  reason: "UNPAIRED_TRANSFER",
  movementIds: ["out", "in"],
  debitId: "out",
  creditId: "in",
  label: "Likely transfer",
});
const openRefund = item({
  id: "FULL_REFUND_AMBIGUOUS:back",
  reason: "FULL_REFUND_AMBIGUOUS",
  movementIds: ["back", "paid"],
  creditId: "back",
  debitId: "paid",
});
const openKind = item({
  id: "UNREVIEWED_KIND:shop",
  reason: "UNREVIEWED_KIND",
  movementIds: ["shop"],
  label: "Shop needs a category",
});
const dismissedParse = dismissReviewItem(
  item({
    id: "INGEST_PARSE:blank.csv",
    reason: "INGEST_PARSE",
    label: "Couldn't read blank.csv",
  }),
);
const resolvedTransfer = resolveReviewItem(openTransfer);

describe("Review page filters and history", () => {
  const rows = [
    txn({ id: "out", amount: -2400, dateIso: "2026-09-14", accountId: "CBA · Everyday", institution: "CBA" }),
    txn({ id: "in", amount: 2400, dateIso: "2026-09-14", accountId: "ING · Savings", institution: "ING" }),
    txn({ id: "paid", amount: -86.4, dateIso: "2026-09-15", accountId: "CBA · Everyday", institution: "CBA" }),
    txn({ id: "back", amount: 86.4, dateIso: "2026-09-16", accountId: "CBA · Everyday", institution: "CBA" }),
    txn({ id: "shop", amount: -64.2, dateIso: "2026-08-01", accountId: "NAB · Classic", institution: "NAB" }),
  ];
  const queue = [openTransfer, openRefund, openKind, dismissedParse, resolvedTransfer];

  it("defaults to OPEN and can show resolved/dismissed history", () => {
    const open = filterReviewItems(queue, { surface: "open", reason: "all" });
    assert.deepEqual(
      open.map((row) => row.id),
      [openTransfer.id, openRefund.id, openKind.id],
    );
    const history = filterReviewItems(queue, { surface: "history", reason: "all" });
    assert.ok(history.every((row) => row.state !== "OPEN"));
    assert.ok(history.some((row) => row.state === "RESOLVED"));
    assert.ok(history.some((row) => row.state === "DISMISSED"));
  });

  it("filters OPEN items by reason_code chips", () => {
    assert.equal(filterReviewItems(queue, { surface: "open", reason: "unpaired" }).length, 1);
    assert.equal(filterReviewItems(queue, { surface: "open", reason: "refund" })[0]?.reason, "FULL_REFUND_AMBIGUOUS");
    assert.equal(filterReviewItems(queue, { surface: "open", reason: "needs_category" })[0]?.reason, "UNREVIEWED_KIND");
  });

  it("filters by account and last 30 days", () => {
    const byAccount = filterReviewItems(
      queue,
      { surface: "open", reason: "all", accountId: "NAB · Classic" },
      rows,
    );
    assert.deepEqual(
      byAccount.map((row) => row.id),
      [openKind.id],
    );
    const recent = filterReviewItems(
      queue,
      { surface: "open", reason: "all", sinceIso: last30DaysSince("2026-09-20") },
      rows,
    );
    assert.ok(recent.every((row) => row.id !== openKind.id));
    assert.ok(recent.some((row) => row.id === openTransfer.id));
  });

  it("nav badge counts OPEN only", () => {
    assert.equal(reviewNavBadgeCount(queue), 3);
    assert.equal(reviewNavBadgeCount([resolvedTransfer, dismissedParse]), 0);
  });

  it("same-institution note only when transfer items are present", () => {
    assert.equal(hasOpenTransferItems(queue), true);
    assert.equal(hasOpenTransferItems([openRefund, openKind]), false);
  });

  it("reads opened-on from the movement date", () => {
    assert.equal(reviewOpenedOn(openTransfer, rows), "2026-09-14");
  });
});

describe("OPEN action matrix", () => {
  const byId = new Map(
    [
      txn({ id: "out", amount: -2400, dateIso: "2026-09-14" }),
      txn({ id: "in", amount: 2400, dateIso: "2026-09-14" }),
      txn({ id: "paid", amount: -86.4, dateIso: "2026-09-15" }),
      txn({ id: "back", amount: 86.4, dateIso: "2026-09-16" }),
    ].map((row) => [row.id, row]),
  );

  it("never leaves an OPEN reason with only Not that", () => {
    const cases: { item: ReviewItem; ctx: Parameters<typeof reviewOpenActions>[1] }[] = [
      { item: openTransfer, ctx: { partnerCount: 2, selectedPartnerId: "in" } },
      { item: item({ id: "UNPAIRED_TRANSFER:out", reason: "UNPAIRED_TRANSFER", debitId: "out", movementIds: ["out"] }), ctx: { partnerCount: 0 } },
      { item: item({ id: "UNPAIRED_TRANSFER:in", reason: "UNPAIRED_TRANSFER", creditId: "in", movementIds: ["in"] }), ctx: { partnerCount: 0, keepAsLabel: "Keep as income" } },
      { item: openRefund, ctx: { partnerCount: 0, paymentCount: 1, selectedPaymentId: "paid" } },
      { item: item({ id: "PARTIAL_REFUND:back", reason: "PARTIAL_REFUND", creditId: "back", movementIds: ["back"] }), ctx: { partnerCount: 0, paymentCount: 0 } },
      { item: item({ id: "FULL_REFUND_AMBIGUOUS:back", reason: "FULL_REFUND_AMBIGUOUS", creditId: "back", movementIds: ["back"] }), ctx: { partnerCount: 0, paymentCount: 2 } },
      { item: openKind, ctx: { partnerCount: 0, paymentCount: 0, selectedCategoryKey: "groceries" } },
      { item: item({ id: "INGEST_PARSE:blank.csv", reason: "INGEST_PARSE" }), ctx: { partnerCount: 0, paymentCount: 0 } },
      { item: item({ id: "AI_LOW_CONFIDENCE:x", reason: "AI_LOW_CONFIDENCE" }), ctx: { partnerCount: 0, paymentCount: 0 } },
      { item: item({ id: "DUPLICATE_HOLD:x", reason: "DUPLICATE_HOLD" }), ctx: { partnerCount: 0, paymentCount: 0 } },
    ];
    for (const row of cases) {
      const actions = reviewOpenActions(row.item, row.ctx);
      assert.ok(openActionsAreUseful(actions), row.item.reason);
      assert.ok(actions.some((action) => action.role === "primary"));
    }
    for (const reason of REVIEW_REASONS) {
      const actions = reviewOpenActions(item({ id: `${reason}:x`, reason }), {
        partnerCount: 0,
        paymentCount: 0,
        selectedCategoryKey: "groceries",
      });
      assert.ok(openActionsAreUseful(actions), reason);
    }
  });

  it("shows Confirm when a partner is picked and Keep as spending when none remain", () => {
    const withPartner = reviewOpenActions(openTransfer, { partnerCount: 1, selectedPartnerId: "in" });
    assert.deepEqual(
      withPartner.map((action) => [action.id, action.enabled]),
      [
        ["confirm", true],
        ["not-that", true],
      ],
    );
    const orphan = reviewOpenActions(openTransfer, { partnerCount: 0, keepAsLabel: keepAsMoneyLabel(openTransfer, byId) });
    assert.deepEqual(
      orphan.map((action) => action.id),
      ["confirm-as-transfer", "keep-as-money", "skip"],
    );
    assert.equal(orphan[0]?.label, "Confirm as transfer");
    assert.equal(orphan[1]?.label, "Keep as spending");
  });

  it("always offers Confirm refund and Mark as income, even without debitId", () => {
    const missing = reviewOpenActions(
      item({ id: "PARTIAL_REFUND:back", reason: "PARTIAL_REFUND", creditId: "back", movementIds: ["back"] }),
      { partnerCount: 0, paymentCount: 0 },
    );
    assert.deepEqual(
      missing.map((action) => [action.id, action.enabled]),
      [
        ["confirm-refund", true],
        ["mark-income", true],
      ],
    );
    const ambiguous = reviewOpenActions(openRefund, { partnerCount: 0, paymentCount: 2 });
    assert.equal(ambiguous.find((action) => action.id === "confirm-refund")?.enabled, false);
    assert.equal(ambiguous.find((action) => action.id === "mark-income")?.enabled, true);
    assert.ok(!ambiguous.some((action) => action.id === "not-that"));
  });

  it("groups no-partner unpaired cards by merchantKey plus account_id", () => {
    const first = txn({
      id: "jl-1",
      amount: -600,
      dateIso: "2026-05-14",
      merchant: "JORDAN LEE S55497275522",
      accountId: "NAB · NAB--3000",
      type: "TRANSFER",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const second = txn({
      id: "jl-2",
      amount: -600,
      dateIso: "2026-05-11",
      merchant: "JORDAN LEE T5",
      accountId: "NAB · NAB--3000",
      type: "TRANSFER",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const otherAccount = txn({
      id: "jl-other-acct",
      amount: -600,
      dateIso: "2026-05-10",
      merchant: "JORDAN LEE T5",
      accountId: "Up · Spending",
      type: "TRANSFER",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const leftover = txn({
      id: "jl-ho",
      amount: -600,
      dateIso: "2026-05-09",
      merchant: "JORDAN LEE HO0191683078",
      accountId: "NAB · NAB--3000",
      type: "TRANSFER",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
    });
    const rows = [first, second, otherAccount, leftover];
    const queue = [
      item({ id: "UNPAIRED_TRANSFER:jl-1", reason: "UNPAIRED_TRANSFER", debitId: "jl-1", movementIds: ["jl-1"] }),
      item({ id: "UNPAIRED_TRANSFER:jl-2", reason: "UNPAIRED_TRANSFER", debitId: "jl-2", movementIds: ["jl-2"] }),
      item({ id: "UNPAIRED_TRANSFER:jl-other-acct", reason: "UNPAIRED_TRANSFER", debitId: "jl-other-acct", movementIds: ["jl-other-acct"] }),
      item({ id: "UNPAIRED_TRANSFER:jl-ho", reason: "UNPAIRED_TRANSFER", debitId: "jl-ho", movementIds: ["jl-ho"] }),
    ];
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(unpairedSimilarityKey(queue[0]!, byId), unpairedSimilarityKey(queue[1]!, byId));
    assert.match(unpairedSimilarityKey(queue[0]!, byId), /\|jordan lee$/);
    assert.notEqual(unpairedSimilarityKey(queue[0]!, byId), unpairedSimilarityKey(queue[2]!, byId));
    assert.notEqual(unpairedSimilarityKey(queue[0]!, byId), unpairedSimilarityKey(queue[3]!, byId));
    const similar = similarOpenUnpaired(queue[0]!, queue, rows);
    assert.deepEqual(
      similar.map((row) => row.id).sort(),
      ["UNPAIRED_TRANSFER:jl-1", "UNPAIRED_TRANSFER:jl-2"],
    );
    assert.deepEqual(
      unpairedSettleTargets(queue[0]!, queue, rows, true).map((row) => row.id).sort(),
      similar.map((row) => row.id).sort(),
    );
    assert.deepEqual(
      unpairedSettleTargets(queue[0]!, queue, rows, false).map((row) => row.id),
      ["UNPAIRED_TRANSFER:jl-1"],
    );
    assert.equal(unpairedAsTransferReason(-600), "not-mine");
    assert.equal(unpairedAsTransferReason(600), "own-account");
  });

  it("gives UNREVIEWED_KIND Assign category and Skip for now", () => {
    const actions = reviewOpenActions(openKind, {
      partnerCount: 0,
      paymentCount: 0,
      selectedCategoryKey: "groceries",
    });
    assert.deepEqual(
      actions.map((action) => action.id),
      ["assign-category", "skip"],
    );
  });
});
