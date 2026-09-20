import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterReviewItems,
  hasOpenTransferItems,
  last30DaysSince,
  reviewNavBadgeCount,
  reviewOpenedOn,
} from "./review-page";
import { dismissReviewItem, resolveReviewItem, type ReviewItem } from "./review-queue";
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
