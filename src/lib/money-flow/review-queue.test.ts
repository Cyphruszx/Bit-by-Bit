/**
 * Slice 3: Spec 7 Review Queue skeleton.
 *
 * OPEN money-trust items are held out of Income / Spending / Refund credits / Net.
 * Only INGEST_PARSE may be dismissed. RESOLVE writes said pairs so Slice 2
 * forgetAutoPairs cannot strip them, and Spec 10 Actual Savings can fire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySilentSameInstitutionUniquePairs, forgetAutoPairs } from "./auto-pairs";
import {
  REVIEW_REASONS,
  buildReviewQueue,
  canDismiss,
  confirmRefundPair,
  confirmTransferPair,
  declineReviewSuggestion,
  declineTransferSuggestion,
  deferReviewItem,
  dismissReviewItem,
  isReviewDeferred,
  moneyTrustHoldIds,
  openReviewCount,
  parseReviewItems,
  refundPaymentsFor,
  resolveReviewItem,
  transferPartnersFor,
  undeferReviewItem,
} from "./review-queue";
import { EMPTY_LEDGER, recordReview } from "./ledger";
import { fileAsLoanDrawdown } from "./review-page";
import { summarizeMoneyFlow } from "./summary";
import { countsAsIncome, countsAsSpending } from "./taxonomy";
import { applyVerdicts, oneKey, verdictFor } from "./verdicts";
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
});

describe("Spec 3/7 silent same-institution pairing", () => {
  const nabOut = txn({
    id: "nab-out",
    amount: -400,
    dateIso: "2026-03-12",
    type: "spent",
    accountId: "NAB · Everyday",
    institution: "NAB",
    merchant: "Transfer To Savings",
    categoryKey: "uncategorised",
  });
  const nabIn = txn({
    id: "nab-in",
    amount: 400,
    dateIso: "2026-03-12",
    type: "earned",
    accountId: "NAB · Savings",
    institution: "NAB",
    merchant: "Transfer From Everyday",
    categoryKey: "uncategorised",
  });
  const upIn = txn({
    id: "up-in",
    amount: 400,
    dateIso: "2026-03-12",
    type: "earned",
    accountId: "Up · Spending",
    institution: "Up",
    merchant: "Osko Payment Received",
    categoryKey: "uncategorised",
  });

  it("does not open unique same-institution pairs and writes the pair", () => {
    const paired = applySilentSameInstitutionUniquePairs([nabOut, nabIn]);
    assert.ok(paired.every((row) => row.transferPair));
    assert.equal(openReviewCount(buildReviewQueue(paired)), 0);
    const flow = summarizeMoneyFlow(paired);
    assert.equal(flow.transfers, 400);
    assert.equal(flow.income, 0);
    assert.equal(flow.spending, 0);
  });

  it("keeps unknown-institution unique pairs OPEN", () => {
    const queue = buildReviewQueue([out, intoSave]);
    assert.ok(queue.some((item) => item.reason === "UNPAIRED_TRANSFER" && item.state === "OPEN"));
    assert.ok(queue[0]?.debitId && queue[0]?.creditId);
  });

  it("keeps cross-institution unique pairs OPEN with a suggested partner", () => {
    const queue = buildReviewQueue([nabOut, upIn]);
    const item = queue.find((row) => row.reason === "UNPAIRED_TRANSFER" && row.state === "OPEN");
    assert.ok(item);
    assert.equal(item?.debitId, "nab-out");
    assert.equal(item?.creditId, "up-in");
    const partners = transferPartnersFor(item!, [nabOut, upIn]);
    assert.equal(partners.length, 1);
    assert.equal(partners[0]?.id, "up-in");
    assert.equal(partners[0]?.confidence, "high");
  });

  it("lets Confirm write a cross-institution pair and clears OPEN", () => {
    const item = buildReviewQueue([nabOut, upIn]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item?.debitId && item.creditId);
    const confirmed = confirmTransferPair([nabOut, upIn], item!.debitId!, item!.creditId!);
    assert.equal(openReviewCount(buildReviewQueue(confirmed)), 0);
    assert.equal(summarizeMoneyFlow(confirmed).transfers, 400);
  });

  it("keeps contested same-institution pairs OPEN for a pick", () => {
    const first = txn({
      id: "c1",
      amount: 2000,
      dateIso: "2026-06-01",
      type: "earned",
      accountId: "NAB · Savings",
      institution: "NAB",
      merchant: "Osko Payment Received",
      description: "Osko Payment Received",
      categoryKey: "uncategorised",
    });
    const second = txn({
      id: "c2",
      amount: 2000,
      dateIso: "2026-06-01",
      type: "earned",
      accountId: "NAB · Offset",
      institution: "NAB",
      merchant: "Wages",
      description: "Wages",
      categoryKey: "uncategorised",
    });
    const debit = txn({
      id: "c-out",
      amount: -2000,
      dateIso: "2026-06-01",
      type: "spent",
      accountId: "NAB · Everyday",
      institution: "NAB",
      merchant: "JORDAN LEE T5",
      description: "JORDAN LEE T5",
      categoryKey: "uncategorised",
    });
    const queue = buildReviewQueue([debit, first, second]);
    const item = queue.find((row) => row.reason === "UNPAIRED_TRANSFER" && row.state === "OPEN");
    assert.ok(item);
    assert.equal(item?.creditId, undefined);
    assert.equal(transferPartnersFor(item!, [debit, first, second]).length, 2);
    const confirmed = confirmTransferPair([debit, first, second], "c-out", "c1");
    assert.equal(confirmed.find((row) => row.id === "c-out")?.transferPair, "c-out~c1");
    assert.equal(confirmed.find((row) => row.id === "c1")?.transferPair, "c-out~c1");
    const leftover = buildReviewQueue(confirmed).filter((row) => row.state === "OPEN" && row.reason === "UNPAIRED_TRANSFER");
    assert.ok(leftover.every((row) => !row.movementIds.includes("c-out") && !row.movementIds.includes("c1")));
  });

  it("Not that stays OPEN and does not dismiss money-trust", () => {
    const item = buildReviewQueue([nabOut, upIn]).find((row) => row.reason === "UNPAIRED_TRANSFER")!;
    const declined = declineTransferSuggestion(item, item.creditId!);
    assert.equal(declined.state, "OPEN");
    assert.ok(declined.declinedCreditIds?.includes("up-in"));
    assert.throws(() => dismissReviewItem(declined), /INGEST_PARSE/);
    const next = buildReviewQueue([nabOut, upIn], { stored: [declined] });
    assert.ok(openReviewCount(next) >= 1);
    assert.ok(next.some((row) => row.state === "OPEN" && row.debitId === "nab-out"));
    assert.ok(next.every((row) => row.creditId !== "up-in" || row.debitId !== "nab-out"));
    const partners = next.flatMap((row) => transferPartnersFor(row, [nabOut, upIn]));
    assert.ok(partners.every((partner) => partner.id !== "up-in"));
  });
});

describe("OPEN settle paths", () => {
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

  it("Mark as income takes a refund credit out of OPEN and off the refund hold", () => {
    const item = buildReviewQueue([paid, back]).find((row) => row.creditId === "back");
    assert.ok(item);
    const judged = applyVerdicts([paid, back], { [oneKey(back)]: verdictFor("earned", "2026-09-20T00:00:00Z") });
    const closed = resolveReviewItem(item!);
    const next = buildReviewQueue(judged, { stored: [closed] });
    assert.ok(!next.some((row) => row.state === "OPEN" && row.creditId === "back"));
    assert.ok(!moneyTrustHoldIds(judged, { stored: [closed] }).has("back"));
    assert.equal(summarizeMoneyFlow(judged).income, 80);
    assert.equal(summarizeMoneyFlow(judged).refunds, 0);
  });

  it("Confirm as transfer marks an orphan TRANSFER without inventing a pair", () => {
    const item = buildReviewQueue([out]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item);
    const judged = applyVerdicts([out], { [oneKey(out)]: verdictFor("not-mine", "2026-09-20T00:00:00Z") });
    assert.equal(judged[0]?.type, "TRANSFER");
    assert.equal(judged[0]?.transferPair, undefined);
    assert.equal(judged[0]?.decidedBy, "user_overridden");
    const closed = resolveReviewItem(item!);
    assert.equal(openReviewCount(buildReviewQueue(judged, { stored: [closed] })), 0);
    const flow = summarizeMoneyFlow(judged);
    assert.equal(flow.income, 0);
    assert.equal(flow.spending, 0);
    assert.equal(flow.net, 0);
    assert.equal(flow.transfers, 0);
  });

  it("Skip for now stays OPEN and rebuilds into the stored deferred hint", () => {
    const item = buildReviewQueue([out]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item);
    const deferred = deferReviewItem(item!);
    assert.equal(deferred.state, "OPEN");
    assert.ok(isReviewDeferred(deferred));
    assert.equal(undeferReviewItem(deferred).deferredAt, undefined);
    const parsed = parseReviewItems([deferred]);
    assert.equal(parsed[0]?.deferredAt, deferred.deferredAt);
    const rebuilt = buildReviewQueue([out], { stored: parsed });
    const held = rebuilt.find((row) => row.id === item!.id);
    assert.equal(held?.state, "OPEN");
    assert.ok(isReviewDeferred(held!));
    assert.equal(openReviewCount(rebuilt), 1);
  });

  it("Apply to similar resolves each matching OPEN orphan and records History", () => {
    const first = txn({
      id: "jl-1",
      amount: -600,
      dateIso: "2026-05-14",
      merchant: "JORDAN LEE S55497275522",
      type: "TRANSFER",
      accountId: "NAB · NAB--3000",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
      categoryKey: "uncategorised",
    });
    const second = txn({
      id: "jl-2",
      amount: -600,
      dateIso: "2026-05-11",
      merchant: "JORDAN LEE T5",
      type: "TRANSFER",
      accountId: "NAB · NAB--3000",
      bank: { category: "Internal transfers", type: "TRANSFER DEBIT" },
      categoryKey: "uncategorised",
    });
    const queue = buildReviewQueue([first, second]);
    const open = queue.filter((row) => row.state === "OPEN" && row.reason === "UNPAIRED_TRANSFER");
    assert.equal(open.length, 2);
    const at = "2026-09-20T00:00:00Z";
    const judged = applyVerdicts([first, second], {
      [oneKey(first)]: verdictFor("not-mine", at),
      [oneKey(second)]: verdictFor("not-mine", at),
    });
    const stored = open.map((row) => resolveReviewItem(row));
    const next = buildReviewQueue(judged, { stored });
    assert.equal(openReviewCount(next), 0);
    assert.equal(stored.filter((row) => row.state === "RESOLVED").length, 2);
    assert.ok(judged.every((row) => row.type === "TRANSFER" && !row.transferPair));
    const flow = summarizeMoneyFlow(judged);
    assert.equal(flow.spending, 0);
    assert.equal(flow.income, 0);
    assert.equal(flow.net, 0);
  });

  it("Confirm as loan files a credit as DEBT_PRINCIPAL and keeps tiles out of Income", () => {
    const draw = txn({
      id: "loan-in",
      amount: 25000,
      dateIso: "2026-03-12",
      type: "TRANSFER",
      accountId: "NAB · Everyday",
      merchant: "SOCIETYONE DRAWDOWN",
      categoryKey: "uncategorised",
      bank: { category: "Internal transfers", type: "TRANSFER CREDIT" },
    });
    const item = buildReviewQueue([draw]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item);
    assert.equal(item?.creditId, "loan-in");
    const at = "2026-09-20T00:00:00Z";
    const filed = fileAsLoanDrawdown(draw);
    const judged = applyVerdicts([filed], { [oneKey(draw)]: verdictFor("borrowed", at) });
    assert.equal(judged[0]?.type, "DEBT_PRINCIPAL");
    assert.equal(judged[0]?.categoryKey, "debt-payments");
    assert.ok(judged[0]?.tags?.includes("Drawdown"));
    assert.equal(judged[0]?.transferPair, undefined);
    assert.equal(judged[0]?.decidedBy, "user_overridden");
    assert.equal(countsAsIncome("DEBT_PRINCIPAL"), false);
    assert.equal(countsAsSpending("DEBT_PRINCIPAL"), false);
    const closed = resolveReviewItem(item!);
    assert.equal(openReviewCount(buildReviewQueue(judged, { stored: [closed] })), 0);
    const flow = summarizeMoneyFlow(judged);
    assert.equal(flow.income, 0);
    assert.equal(flow.spending, 0);
    assert.equal(flow.net, 0);
    assert.equal(flow.cashIn, 25000);
    assert.equal(flow.transfers, 0);
  });

  it("Apply to similar Confirm as loan resolves matching credit orphans", () => {
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
    const queue = buildReviewQueue([first, second]);
    const open = queue.filter((row) => row.state === "OPEN" && row.reason === "UNPAIRED_TRANSFER");
    assert.equal(open.length, 2);
    const at = "2026-09-20T00:00:00Z";
    const judged = applyVerdicts([fileAsLoanDrawdown(first), fileAsLoanDrawdown(second)], {
      [oneKey(first)]: verdictFor("borrowed", at),
      [oneKey(second)]: verdictFor("borrowed", at),
    });
    const stored = open.map((row) => resolveReviewItem(row));
    const next = buildReviewQueue(judged, { stored });
    assert.equal(openReviewCount(next), 0);
    assert.ok(judged.every((row) => row.type === "DEBT_PRINCIPAL" && !row.transferPair));
    assert.equal(summarizeMoneyFlow(judged).income, 0);
    assert.equal(summarizeMoneyFlow(judged).cashIn, 16000);
  });

  it("persists a skipped OPEN item and drops it when Skip is cleared", () => {
    const item = buildReviewQueue([out]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item);
    const deferred = deferReviewItem(item!);
    const stored = recordReview(EMPTY_LEDGER, deferred);
    assert.equal(stored.review?.[0]?.state, "OPEN");
    assert.equal(stored.review?.[0]?.deferredAt, deferred.deferredAt);
    const restored = recordReview(stored, undeferReviewItem(deferred));
    assert.equal((restored.review ?? []).some((row) => row.id === item!.id), false);
  });

  it("Keep as spending settles an orphan transfer via spent verdict", () => {
    const item = buildReviewQueue([out]).find((row) => row.reason === "UNPAIRED_TRANSFER");
    assert.ok(item);
    assert.equal(transferPartnersFor(item!, [out]).length, 0);
    const judged = applyVerdicts([out], { [oneKey(out)]: verdictFor("spent", "2026-09-20T00:00:00Z") });
    const closed = resolveReviewItem(item!);
    assert.equal(openReviewCount(buildReviewQueue(judged, { stored: [closed] })), 0);
    assert.ok(!moneyTrustHoldIds(judged, { stored: [closed] }).has("out"));
    assert.equal(summarizeMoneyFlow(judged).spending, 400);
  });

  it("Not that on a refund declines the payment and still leaves a primary path", () => {
    const item = buildReviewQueue([paid, back]).find((row) => row.creditId === "back")!;
    assert.equal(item.debitId, "paid");
    assert.equal(refundPaymentsFor(item, [paid, back]).length, 1);
    const declined = declineReviewSuggestion(item, "paid");
    assert.equal(declined.state, "OPEN");
    assert.ok(declined.declinedDebitIds?.includes("paid"));
    assert.equal(declined.debitId, undefined);
    const next = buildReviewQueue([paid, back], { stored: [declined] });
    const leftover = next.find((row) => row.state === "OPEN" && row.creditId === "back");
    assert.ok(leftover);
    assert.equal(leftover?.debitId, undefined);
    assert.equal(refundPaymentsFor(leftover!, [paid, back]).length, 0);
  });

  it("Confirm refund still lists payments when debitId is unset", () => {
    const first = txn({
      id: "paid-a",
      amount: -80,
      dateIso: "2026-03-01",
      merchant: "Kmart A",
      type: "spent",
      accountId: "NAB · 1",
    });
    const second = txn({
      id: "paid-b",
      amount: -80,
      dateIso: "2026-03-02",
      merchant: "Kmart B",
      type: "spent",
      accountId: "NAB · 1",
    });
    const item = buildReviewQueue([first, second, back]).find((row) => row.creditId === "back");
    assert.ok(item);
    assert.equal(item?.debitId, undefined);
    const payments = refundPaymentsFor(item!, [first, second, back]);
    assert.equal(payments.length, 2);
  });
});
