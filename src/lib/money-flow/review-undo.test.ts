import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_LEDGER, parseLedger, rememberReviewUndo, undoLastReviewAction } from "./ledger";
import { pageReviewItems, REVIEW_PAGE_SIZE } from "./review-page";
import {
  buildReviewQueue,
  confirmTransferPair,
  dismissReviewItem,
  moneyTrustHoldIds,
  openReviewCount,
  resolveReviewItem,
  type ReviewItem,
} from "./review-queue";
import { fileAsLoanDrawdown } from "./review-page";
import {
  applyReviewUndoParts,
  captureReviewUndo,
  lastReviewUndo,
  parseReviewUndo,
  pushReviewUndo,
  REVIEW_UNDO_LIMIT,
} from "./review-undo";
import { summarizeMoneyFlow } from "./summary";
import { applyVerdicts, oneKey, verdictFor } from "./verdicts";
import type { InterpretedTransaction } from "./types";

function txn(
  over: Partial<InterpretedTransaction> & Pick<InterpretedTransaction, "id" | "amount" | "dateIso">,
): InterpretedTransaction {
  return {
    merchant: over.merchant ?? "Cafe",
    categoryKey: over.categoryKey ?? (over.amount > 0 ? "salary" : "groceries"),
    date: over.dateIso,
    type: over.type ?? (over.amount > 0 ? "earned" : "spent"),
    sourceFile: over.sourceFile ?? "demo.csv",
    confidence: 1,
    ...over,
  };
}

function item(over: Partial<ReviewItem> & Pick<ReviewItem, "id" | "reason">): ReviewItem {
  return {
    state: "OPEN",
    movementIds: over.movementIds ?? [],
    label: over.label ?? over.reason,
    ...over,
  };
}

const nabOut = txn({
  id: "nab-out",
  amount: -400,
  dateIso: "2026-03-12",
  type: "spent",
  accountId: "NAB · Everyday",
  institution: "NAB",
  merchant: "Transfer To Up",
  categoryKey: "uncategorised",
  bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
});
const upIn = txn({
  id: "up-in",
  amount: 400,
  dateIso: "2026-03-12",
  type: "earned",
  accountId: "Up · Spending",
  institution: "Up",
  merchant: "Transfer From NAB",
  categoryKey: "uncategorised",
  bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
});

describe("Review pagination", () => {
  it("shows at most 5 cards per page", () => {
    const rows = Array.from({ length: 12 }, (_, index) => index);
    const first = pageReviewItems(rows, 0);
    assert.equal(REVIEW_PAGE_SIZE, 5);
    assert.equal(first.items.length, 5);
    assert.deepEqual(first.items, [0, 1, 2, 3, 4]);
    assert.equal(first.from, 1);
    assert.equal(first.to, 5);
    assert.equal(first.pageCount, 3);
    const next = pageReviewItems(rows, 1);
    assert.deepEqual(next.items, [5, 6, 7, 8, 9]);
    const last = pageReviewItems(rows, 2);
    assert.deepEqual(last.items, [10, 11]);
    assert.equal(pageReviewItems(rows, 9).page, 2);
  });
});

describe("Review undo", () => {
  it("restores a confirmed transfer pair and the OPEN money-trust hold", () => {
    const queue = buildReviewQueue([nabOut, upIn]);
    const open = queue.find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(open?.debitId && open.creditId);
    const action = captureReviewUndo({
      transactions: [nabOut, upIn],
      label: "Confirm transfer",
      items: [open!],
      movementIds: [open!.debitId!, open!.creditId!],
      verdictKeys: [],
    });
    const paired = confirmTransferPair([nabOut, upIn], open!.debitId!, open!.creditId!);
    const closed = resolveReviewItem(open!);
    assert.equal(openReviewCount(buildReviewQueue(paired, { stored: [closed] })), 0);
    assert.equal(summarizeMoneyFlow(paired).transfers, 400);
    const undone = applyReviewUndoParts(action, { review: [closed], transactions: paired });
    assert.equal(undone.transactions.every((row) => !row.transferPair), true);
    const next = buildReviewQueue(undone.transactions, { stored: undone.review ?? [] });
    assert.ok(next.some((row) => row.state === "OPEN" && row.reason === "UNPAIRED_TRANSFER"));
    assert.ok(moneyTrustHoldIds(undone.transactions, { stored: undone.review ?? [] }).has("nab-out"));
    assert.equal(summarizeMoneyFlow(undone.transactions).transfers, 0);
  });

  it("undoes an Apply to similar loan batch for every sibling", () => {
    const first = txn({
      id: "loan-1",
      amount: 8000,
      dateIso: "2026-05-14",
      merchant: "LATITUDE FIN S55497275522",
      type: "TRANSFER",
      accountId: "NAB · Everyday",
      bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
      categoryKey: "uncategorised",
    });
    const second = txn({
      id: "loan-2",
      amount: 8000,
      dateIso: "2026-05-11",
      merchant: "LATITUDE FIN H0191683078",
      type: "TRANSFER",
      accountId: "NAB · Everyday",
      bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
      categoryKey: "uncategorised",
    });
    const open = buildReviewQueue([first, second]).filter(
      (row) => row.state === "OPEN" && row.reason === "UNPAIRED_TRANSFER",
    );
    assert.equal(open.length, 2);
    const at = "2026-09-20T00:00:00Z";
    const action = captureReviewUndo({
      transactions: [first, second],
      label: "Confirm as loan (similar)",
      items: open,
      movementIds: ["loan-1", "loan-2"],
      verdictKeys: [oneKey(first), oneKey(second)],
      ruleKeys: ["latitude fin"],
    });
    const judged = applyVerdicts([fileAsLoanDrawdown(first), fileAsLoanDrawdown(second)], {
      [oneKey(first)]: verdictFor("borrowed", at),
      [oneKey(second)]: verdictFor("borrowed", at),
    });
    const stored = open.map((row) => resolveReviewItem(row));
    assert.equal(summarizeMoneyFlow(judged).income, 0);
    const undone = applyReviewUndoParts(action, {
      review: stored,
      verdicts: {
        [oneKey(first)]: verdictFor("borrowed", at),
        [oneKey(second)]: verdictFor("borrowed", at),
      },
      rules: { "latitude fin": { categoryKey: "debt-payments", at } },
      transactions: judged,
    });
    assert.equal(undone.verdicts, undefined);
    assert.equal(undone.rules, undefined);
    assert.ok(undone.transactions.every((row) => row.type === "TRANSFER" && row.categoryKey === "uncategorised"));
    const next = buildReviewQueue(undone.transactions, { stored: undone.review ?? [] });
    assert.equal(openReviewCount(next), 2);
    assert.ok(moneyTrustHoldIds(undone.transactions, { stored: undone.review ?? [] }).has("loan-1"));
    assert.ok(moneyTrustHoldIds(undone.transactions, { stored: undone.review ?? [] }).has("loan-2"));
  });

  it("undoes a parse dismiss back to OPEN", () => {
    const parseItem = item({
      id: "INGEST_PARSE:blank.csv",
      reason: "INGEST_PARSE",
      label: "Couldn't read blank.csv",
    });
    const dismissed = dismissReviewItem(parseItem);
    const action = captureReviewUndo({
      transactions: [],
      review: [],
      label: "Dismiss parse",
      items: [parseItem],
      movementIds: [],
      verdictKeys: [],
    });
    const undone = applyReviewUndoParts(action, { review: [dismissed], transactions: [] });
    assert.equal(undone.review, undefined);
    const next = buildReviewQueue([], {
      stored: undone.review ?? [],
      imports: [{ id: "blank.csv", filename: "blank.csv", error: "empty" }],
    });
    assert.ok(next.some((row) => row.id === parseItem.id && row.state === "OPEN"));
  });

  it("keeps the last 5 undo actions and round-trips through the ledger", () => {
    const seed = item({ id: "INGEST_PARSE:a", reason: "INGEST_PARSE", label: "a" });
    let stack = undefined as ReturnType<typeof pushReviewUndo> | undefined;
    for (let index = 0; index < 6; index += 1) {
      stack = pushReviewUndo(
        stack,
        captureReviewUndo({
          transactions: [],
          label: `Dismiss ${index}`,
          items: [{ ...seed, id: `INGEST_PARSE:${index}` }],
          movementIds: [],
          verdictKeys: [],
        }),
      );
    }
    assert.equal(stack?.length, REVIEW_UNDO_LIMIT);
    assert.equal(lastReviewUndo(stack)?.label, "Dismiss 5");
    const parsed = parseReviewUndo(stack);
    assert.equal(parsed.length, 5);
    assert.equal(parsed[0]?.label, "Dismiss 1");
    const ledger = rememberReviewUndo(EMPTY_LEDGER, parsed[4]!);
    const raw = JSON.parse(JSON.stringify({ ...ledger, entries: [], imports: [] }));
    const held = parseLedger(raw);
    assert.equal(held?.reviewUndo?.[0]?.label, "Dismiss 5");
    assert.equal(undoLastReviewAction(held!).reviewUndo, undefined);
  });
});
