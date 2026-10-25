"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { rehydrateLedger, useMoneyFlow } from "@/components/money-flow-provider";
import { ReviewAnswerList, ReviewSplit, type ReviewSplitRow } from "@/app/(app)/review/review-split";
import { formatAud, formatSignedAud } from "@/lib/format";
import { accountCaption } from "@/lib/money-flow/account-identity";
import { accountsFrom } from "@/lib/money-flow/accounts";
import { pickerGroups } from "@/lib/money-flow/category-book";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { APP_TIME_ZONE } from "@/lib/money-flow/period";
import {
  applyReviewAnswer,
  formatReviewWeekday,
  pageIndexForId,
  reviewInspectorEyebrow,
  reviewInspectorQuestion,
  reviewLedgerGroup,
  reviewRowCaption,
  reviewRowTitle,
  REVIEW_SURFACE_REASONS,
  selectReviewRow,
  selectionAfterAnswer,
  stepReviewSelection,
} from "@/lib/money-flow/review-inspector";
import {
  filterReviewItems,
  hasOpenTransferItems,
  keepAsMoneyLabel,
  last30DaysSince,
  pageReviewItems,
  REVIEW_PAGE_SIZE,
  reviewItemIsCredit,
  reviewMovementFacts,
  reviewOpenActions,
  similarMovementPreviews,
  similarOpenUnpaired,
  skippedOpenCount,
  type ReviewOpenActionId,
  type ReviewReasonFilter,
  type ReviewSurface,
} from "@/lib/money-flow/review-page";
import {
  isReviewDeferred,
  refundPaymentsFor,
  transferPartnersFor,
  type RefundPayment,
  type ReviewItem,
  type TransferConfidence,
  type TransferPartner,
} from "@/lib/money-flow/review-queue";
import { UNCATEGORISED } from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

const CONFIDENCE_LABEL: Record<TransferConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ReviewView() {
  const flow = useMoneyFlow();
  const {
    accountNames,
    allTransactions,
    assignReviewCategory,
    confirmReviewAsTransfer,
    confirmReviewAsLoan,
    confirmReviewRefund,
    confirmReviewTransfer,
    declineReviewItem,
    dismissReviewItem,
    institutionOverrides,
    keepReviewAsMoney,
    keepReviewFiling,
    markReviewIncome,
    mergedInto,
    payers,
    review,
    skipReviewItem,
    undeferReviewItem,
    lastReviewUndo,
    undoReviewAction,
    ready,
    loadError,
  } = flow;
  const [surface, setSurface] = useState<ReviewSurface>("open");
  const [reason, setReason] = useState<ReviewReasonFilter>("all");
  const [accountId, setAccountId] = useState<string | undefined>();
  const [last30, setLast30] = useState(false);
  const [hideSameInstNote, setHideSameInstNote] = useState(false);
  const [hiddenUndoAt, setHiddenUndoAt] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers, mergedInto }),
    [accountNames, institutionOverrides, payers, mergedInto],
  );
  const matching = useMemo(
    () => ({ institutions: institutionOverrides, accounts: accountNames, mergedInto }),
    [accountNames, institutionOverrides, mergedInto],
  );
  const today = todayIso();
  const sinceIso = last30 ? last30DaysSince(today) : undefined;
  const items = useMemo(
    () => filterReviewItems(review, { surface, reason, accountId, sinceIso }, allTransactions, registry),
    [accountId, allTransactions, reason, registry, review, sinceIso, surface],
  );
  const openCount = useMemo(
    () =>
      filterReviewItems(review, { surface: "open", reason: "all", accountId, sinceIso }, allTransactions, registry)
        .length,
    [accountId, allTransactions, registry, review, sinceIso],
  );
  const skippedBadge = useMemo(
    () =>
      filterReviewItems(review, { surface: "open", reason: "skipped", accountId, sinceIso }, allTransactions, registry)
        .length,
    [accountId, allTransactions, registry, review, sinceIso],
  );
  const paged = useMemo(() => pageReviewItems(items, page), [items, page]);
  const accounts = useMemo(() => accountsFrom(allTransactions, registry), [allTransactions, registry]);
  const byId = useMemo(() => new Map(allTransactions.map((txn) => [txn.id, txn])), [allTransactions]);
  const skippedWaiting = skippedOpenCount(review);
  const showSameInstNote =
    !hideSameInstNote &&
    hasOpenTransferItems(review.filter((item) => !isReviewDeferred(item))) &&
    surface === "open" &&
    reason !== "skipped";
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  const visibleSelection = selectedId && ids.includes(selectedId) ? selectedId : null;

  function choose(id: string) {
    const next = selectReviewRow(id);
    setSelectedId(next.selectedId);
    setActionError(null);
    setPage(pageIndexForId(ids, next.selectedId, REVIEW_PAGE_SIZE));
  }

  function moveAfter(removedIds: string[]) {
    const next =
      removedIds.length === 1
        ? applyReviewAnswer(ids, removedIds[0]!)
        : (() => {
            const selected = selectionAfterAnswer(ids, removedIds);
            return selected ? selectReviewRow(selected) : { selectedId: null, open: false };
          })();
    setSelectedId(next.selectedId);
    const remaining = ids.filter((id) => !removedIds.includes(id));
    setPage(pageIndexForId(remaining, next.selectedId, REVIEW_PAGE_SIZE));
  }

  const accountLabel = (id: string) => {
    const txn = byId.get(id);
    return txn ? accountCaption(txn, registry) : id;
  };

  const rows: ReviewSplitRow[] = paged.items.map((item) => {
    const partners = transferPartnersFor(item, allTransactions, matching);
    const payments = refundPaymentsFor(item, allTransactions);
    const facts = reviewMovementFacts(item, byId, accountLabel);
    const primary = facts[0];
    return {
      id: item.id,
      group: reviewLedgerGroup(item.reason),
      dateLabel: primary ? formatDisplayDate(primary.dateIso) : "",
      title: reviewRowTitle(item, primary?.merchant),
      caption: reviewRowCaption(item.reason, {
        partnerCount: partners.length,
        paymentCount: payments.length,
        credit: reviewItemIsCredit(item, byId),
      }),
      amountLabel: primary ? formatSignedAud(primary.amount) : "",
    };
  });

  const selected = items.find((item) => item.id === visibleSelection) ?? null;
  const filtered =
    Boolean(accountId) || last30 || (reason !== "all" && reason !== "skipped");
  const empty = emptyCopy({
    surface,
    reason,
    filtered,
    skippedWaiting,
    onSkipped: () => {
      setReason("skipped");
      setPage(0);
    },
    onHistory: () => {
      setSurface("history");
      if (reason === "skipped") setReason("all");
      setPage(0);
    },
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const nextId = stepReviewSelection(ids, visibleSelection, key === "j" ? 1 : -1);
        if (!nextId) return;
        const next = selectReviewRow(nextId);
        setSelectedId(next.selectedId);
        setActionError(null);
        setPage(pageIndexForId(ids, next.selectedId, REVIEW_PAGE_SIZE));
        return;
      }
      if (key === "u" && lastReviewUndo) {
        event.preventDefault();
        undoReviewAction();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, lastReviewUndo, undoReviewAction, visibleSelection]);

  const panelError = loadError ?? actionError;

  return (
    <div className="font-sans text-ink">
      <h1 className="text-[32px] !font-bold !tracking-[-0.5px] text-ink">Review</h1>
      <p className="mt-1.5 text-sm text-muted">Pick a row to see its question. Answers only save from the panel.</p>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Review list"
            className="inline-flex flex-wrap gap-0.5 rounded-[4px] border-2 border-line bg-surface p-0.5"
          >
            <Segment
              active={surface === "open" && reason !== "skipped"}
              onClick={() => {
                setSurface("open");
                if (reason === "skipped") setReason("all");
                setPage(0);
              }}
            >
              {`Open ${openCount}`}
            </Segment>
            <Segment
              active={surface === "open" && reason === "skipped"}
              onClick={() => {
                setSurface("open");
                setReason("skipped");
                setPage(0);
              }}
            >
              {`Skipped ${skippedBadge}`}
            </Segment>
            <Segment
              active={surface === "history"}
              onClick={() => {
                setSurface("history");
                if (reason === "skipped") setReason("all");
                setPage(0);
              }}
            >
              History
            </Segment>
          </div>
          {reason !== "skipped" ? (
            <div
              role="group"
              aria-label="Reason"
              className="inline-flex flex-wrap gap-0.5 rounded-[4px] border-2 border-line bg-surface p-0.5"
            >
              {REVIEW_SURFACE_REASONS.map((chip) => (
                <Segment
                  key={chip.id}
                  active={reason === chip.id}
                  onClick={() => {
                    setReason(chip.id);
                    setPage(0);
                  }}
                >
                  {chip.label}
                </Segment>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Account"
            value={accountId ?? ""}
            onChange={(event) => {
              setAccountId(event.target.value || undefined);
              setPage(0);
            }}
            className="h-11 min-h-11 rounded-[4px] border-2 border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-primary"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Date"
            value={last30 ? "30" : "any"}
            onChange={(event) => {
              setLast30(event.target.value === "30");
              setPage(0);
            }}
            className="h-11 min-h-11 rounded-[4px] border-2 border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-primary"
          >
            <option value="any">Any date</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
      </div>

      {showSameInstNote ? (
        <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-[4px] border-2 border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft">
          <span>Same-institution unique pairs are matched automatically and not listed.</span>
          <button
            type="button"
            onClick={() => setHideSameInstNote(true)}
            className="inline-flex size-11 items-center justify-center rounded-[4px] text-muted hover:text-ink"
            aria-label="Dismiss same-institution note"
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        <ReviewSplit
          status={ready ? "ready" : "loading"}
          rows={rows}
          selectedId={selected?.id ?? null}
          onSelect={choose}
          onClose={() => setSelectedId(null)}
          error={panelError}
          onRetry={() => {
            setActionError(null);
            void rehydrateLedger();
          }}
          empty={ready && !panelError && items.length === 0 ? empty : null}
          inspector={
            selected ? (
              <InspectorSession
                key={selected.id}
                item={selected}
                history={surface === "history"}
                byId={byId}
                partners={transferPartnersFor(selected, allTransactions, matching)}
                payments={refundPaymentsFor(selected, allTransactions)}
                similar={similarOpenUnpaired(selected, review, allTransactions, matching, registry)}
                accountLabel={accountLabel}
                canUndo={Boolean(lastReviewUndo?.itemIds.includes(selected.id))}
                onUndo={undoReviewAction}
                onAnswered={moveAfter}
                onFail={(message) => setActionError(message)}
                onAssignCategory={(merchant, categoryKey) => assignReviewCategory(selected, merchant, categoryKey)}
                onConfirmAsTransfer={(similar) => confirmReviewAsTransfer(selected, similar)}
                onConfirmAsLoan={(similar) => confirmReviewAsLoan(selected, similar)}
                onConfirmRefund={(debitId) => confirmReviewRefund(selected, debitId)}
                onConfirmTransfer={(creditId) => confirmReviewTransfer(selected, creditId)}
                onDecline={(partnerId) => declineReviewItem(selected, partnerId)}
                onDismiss={() => dismissReviewItem(selected)}
                onKeepAsMoney={(similar) => keepReviewAsMoney(selected, similar)}
                onKeepFiling={() => keepReviewFiling(selected)}
                onMarkIncome={() => markReviewIncome(selected)}
                onSkip={() => skipReviewItem(selected)}
                onUndefer={() => undeferReviewItem(selected)}
              />
            ) : null
          }
        />
      </div>

      {paged.total > REVIEW_PAGE_SIZE ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            Showing {paged.from}–{paged.to} of {paged.total}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={paged.page === 0}
              onClick={() => setPage(paged.page - 1)}
              className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-line bg-surface px-4 text-xs font-semibold text-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            {paged.page < paged.pageCount - 1 ? (
              <button
                type="button"
                onClick={() => setPage(paged.page + 1)}
                className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-xs font-bold text-on-primary shadow-card"
              >
                Load more
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {lastReviewUndo && hiddenUndoAt !== lastReviewUndo.at ? (
        <div className="mt-4 flex items-center gap-3 rounded-[4px] border-2 border-ink bg-surface py-1.5 pr-1.5 pl-4 text-ink shadow-card">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {lastReviewUndo.label}
              {lastReviewUndo.itemIds.length > 1 ? ` · ${lastReviewUndo.itemIds.length} items` : ""}
            </p>
            <p className="text-[12.5px] text-muted">Undo puts them back in Open.</p>
          </div>
          <button
            type="button"
            onClick={undoReviewAction}
            className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-line bg-surface px-3.5 text-sm font-semibold text-primary"
          >
            Undo
          </button>
          <button
            type="button"
            aria-label="Dismiss undo"
            onClick={() => setHiddenUndoAt(lastReviewUndo.at)}
            className="inline-flex size-11 items-center justify-center rounded-[4px] text-muted"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

function InspectorSession({
  item,
  history,
  byId,
  partners,
  payments,
  similar,
  accountLabel,
  canUndo,
  onUndo,
  onAnswered,
  onFail,
  onAssignCategory,
  onConfirmAsTransfer,
  onConfirmAsLoan,
  onConfirmRefund,
  onConfirmTransfer,
  onDecline,
  onDismiss,
  onKeepAsMoney,
  onKeepFiling,
  onMarkIncome,
  onSkip,
  onUndefer,
}: {
  item: ReviewItem;
  history: boolean;
  byId: Map<string, InterpretedTransaction>;
  partners: TransferPartner[];
  payments: RefundPayment[];
  similar: ReviewItem[];
  accountLabel: (id: string) => string;
  canUndo: boolean;
  onUndo: () => void;
  onAnswered: (removedIds: string[]) => void;
  onFail: (message: string) => void;
  onAssignCategory: (merchant: string, categoryKey: string) => void;
  onConfirmAsTransfer: (similar?: ReviewItem[]) => void;
  onConfirmAsLoan: (similar?: ReviewItem[]) => void;
  onConfirmRefund: (debitId?: string) => void;
  onConfirmTransfer: (creditId: string) => void;
  onDecline: (partnerId?: string) => void;
  onDismiss: () => void;
  onKeepAsMoney: (similar?: ReviewItem[]) => void;
  onKeepFiling: () => void;
  onMarkIncome: () => void;
  onSkip: () => void;
  onUndefer: () => void;
}) {
  const suggestions = pickerGroups()
    .flatMap((group) => group.categories)
    .slice(0, 3);
  const [pickedPartner, setPickedPartner] = useState<string | undefined>(item.creditId ?? partners[0]?.id);
  const [pickedPayment, setPickedPayment] = useState<string | undefined>(
    item.debitId ?? (payments.length === 1 ? payments[0]?.id : undefined),
  );
  const [pickedCategory, setPickedCategory] = useState<string | undefined>(suggestions[0]?.key);
  const [applySimilar, setApplySimilar] = useState(similar.length > 1);
  const selectedPartner = partners.some((partner) => partner.id === pickedPartner) ? pickedPartner : partners[0]?.id;
  const selectedPayment = payments.some((payment) => payment.id === pickedPayment)
    ? pickedPayment
    : payments.length === 1
      ? payments[0]?.id
      : undefined;
  const merchant = item.label.replace(/ needs a category$/i, "");
  const facts = reviewMovementFacts(item, byId, accountLabel);
  const primary = facts[0];
  const similarPreviews = similarMovementPreviews(similar, [...byId.values()]);
  const deferred = isReviewDeferred(item);
  const actions = reviewOpenActions(item, {
    partnerCount: partners.length,
    paymentCount: payments.length,
    selectedPartnerId: selectedPartner,
    selectedPaymentId: selectedPayment,
    selectedCategoryKey: pickedCategory,
    keepAsLabel: keepAsMoneyLabel(item, byId),
    deferred,
    isCredit: reviewItemIsCredit(item, byId),
  });
  const showSimilar = partners.length === 0 && similarPreviews.length > 1 && !history;
  const question = reviewInspectorQuestion(item, { partnerCount: partners.length, history });
  const meta = primary
    ? `${primary.account} · ${formatReviewWeekday(primary.dateIso)} · ${formatSignedAud(primary.amount)}`
    : item.label;

  function run(action: ReviewOpenActionId) {
    const batched =
      applySimilar &&
      similar.length > 1 &&
      (action === "confirm-as-transfer" || action === "confirm-as-loan" || action === "keep-as-money");
    const batch = batched ? similar : undefined;
    try {
      if (action === "confirm" && selectedPartner) onConfirmTransfer(selectedPartner);
      if (action === "confirm-as-transfer") onConfirmAsTransfer(batch);
      if (action === "confirm-as-loan") onConfirmAsLoan(batch);
      if (action === "confirm-refund") onConfirmRefund(selectedPayment);
      if (action === "mark-income") onMarkIncome();
      if (action === "keep-as-money") onKeepAsMoney(batch);
      if (action === "assign-category" && pickedCategory) onAssignCategory(merchant, pickedCategory);
      if (action === "skip") onSkip();
      if (action === "undefer") onUndefer();
      if (action === "dismiss") onDismiss();
      if (action === "not-that") onDecline(selectedPartner ?? selectedPayment);
      if (action === "keep-filing") onKeepFiling();
      if (action !== "not-that") onAnswered(batch ? batch.map((row) => row.id) : [item.id]);
    } catch (error) {
      onFail(error instanceof Error ? error.message : "We couldn’t load your review items");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="inline-flex h-[22px] items-center rounded-[4px] bg-accent-surface px-1.5 text-[11px] font-bold tracking-wide text-primary-strong">
            {reviewInspectorEyebrow(item, { partnerCount: partners.length, history, deferred })}
          </span>
          <h2 className="mt-1.5 text-xl font-bold text-ink">{reviewRowTitle(item, primary?.merchant)}</h2>
          <p className="mt-1 text-[13px] text-muted">{meta}</p>
          {primary && primary.line !== primary.merchant ? (
            <p className="mt-1 text-xs text-ink-soft">{primary.line}</p>
          ) : null}
        </div>
        {!history && !deferred && actions.some((action) => action.id === "skip") ? (
          <button
            type="button"
            aria-label="Skip for now"
            onClick={() => run("skip")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] border-2 border-line bg-surface text-primary"
          >
            <SkipIcon />
          </button>
        ) : null}
      </div>

      {facts.length > 1 ? (
        <ul className="flex flex-col gap-2">
          {facts.map((fact) => (
            <li key={fact.id} className="rounded-[4px] border-2 border-line bg-surface-subtle px-3 py-2">
              <p className="text-[10.5px] font-bold tracking-wide text-muted uppercase">
                {fact.role === "out" ? "Out" : fact.role === "in" ? "In" : "Movement"}
              </p>
              <p className="text-sm font-semibold text-ink tabular-nums">{formatSignedAud(fact.amount)}</p>
              <p className="text-xs text-ink-soft">
                {fact.account} · {formatDisplayDate(fact.dateIso)} · {fact.merchant}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {question ? <p className="text-base font-bold text-ink">{question}</p> : null}
      {item.reason === "INGEST_PARSE" && !history ? <p className="text-sm text-ink">{item.label}</p> : null}

      {item.reason === "UNPAIRED_TRANSFER" && !history && partners.length > 0 ? (
        <div>
          <p className="text-sm font-bold text-ink">Suggested partners</p>
          <ul className="mt-2 space-y-2">
            {partners.map((partner) => {
              const active = selectedPartner === partner.id;
              return (
                <li key={partner.id}>
                  <button
                    type="button"
                    onClick={() => setPickedPartner(partner.id)}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-[4px] border-2 px-3 py-2 text-left ${
                      active ? "border-primary bg-accent-surface" : "border-line bg-surface"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{partner.account}</span>
                      <span className="block text-xs text-muted">
                        Deposit {formatAud(partner.amount)} · {formatDisplayDate(partner.dateIso)} · {partner.merchant}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-[4px] bg-accent-surface px-2 py-1 text-[11px] font-bold text-primary-strong">
                      {CONFIDENCE_LABEL[partner.confidence]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {(item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") && !history && payments.length > 1 ? (
        <div>
          <p className="text-sm font-bold text-ink">Matching payments</p>
          <ul className="mt-2 space-y-2">
            {payments.map((payment) => {
              const active = selectedPayment === payment.id;
              return (
                <li key={payment.id}>
                  <button
                    type="button"
                    onClick={() => setPickedPayment(payment.id)}
                    className={`flex min-h-11 w-full items-center rounded-[4px] border-2 px-3 py-2 text-left ${
                      active ? "border-primary bg-accent-surface" : "border-line bg-surface"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{payment.merchant}</span>
                      <span className="block text-xs text-muted">
                        {formatSignedAud(payment.amount)} · {formatDisplayDate(payment.dateIso)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {item.reason === "UNREVIEWED_KIND" && !history ? (
        <div>
          <p className="text-sm font-bold text-ink">{merchant}</p>
          {item.movementIds.length > facts.length ? (
            <p className="text-xs text-muted">
              {item.movementIds.length} movements · showing {facts.length}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {suggestions.map((category) => (
              <button
                key={category.key}
                type="button"
                onClick={() => setPickedCategory(category.key)}
                className={`inline-flex min-h-11 items-center rounded-[4px] border-2 px-3 text-xs font-semibold ${
                  pickedCategory === category.key
                    ? "border-primary bg-accent-surface text-primary-strong"
                    : "border-line bg-surface text-ink-soft"
                }`}
              >
                {category.label}
              </button>
            ))}
            <label className="inline-flex min-h-11 items-center">
              <span className="sr-only">Category for {merchant}</span>
              <select
                value={
                  suggestions.some((category) => category.key === pickedCategory)
                    ? UNCATEGORISED
                    : (pickedCategory ?? UNCATEGORISED)
                }
                onChange={(event) => {
                  if (event.target.value !== UNCATEGORISED) setPickedCategory(event.target.value);
                }}
                className="h-11 min-h-11 rounded-[4px] border-2 border-line bg-surface px-3 text-xs font-semibold text-ink outline-none focus:border-primary"
              >
                <option value={UNCATEGORISED}>Other</option>
                {pickerGroups().map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.categories.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {history ? (
        canUndo ? (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex min-h-11 items-center justify-center rounded-[4px] border-2 border-line bg-surface px-4 text-sm font-semibold text-ink-soft"
          >
            Undo
          </button>
        ) : null
      ) : (
        <ReviewAnswerList actions={actions.filter((action) => action.id !== "skip")} onAction={run} />
      )}

      {showSimilar ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={applySimilar}
              onChange={(event) => setApplySimilar(event.target.checked)}
              className="size-4 accent-primary"
            />
            Apply to {similarPreviews.length} similar
          </label>
          <ul className={applySimilar ? "space-y-1.5" : "space-y-1.5 opacity-60"}>
            {similarPreviews.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-ink-soft">{row.line}</span>
                <span className="shrink-0 text-muted tabular-nums">
                  {formatDisplayDate(row.dateIso)} · {formatSignedAud(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function emptyCopy({
  surface,
  reason,
  filtered,
  skippedWaiting,
  onSkipped,
  onHistory,
}: {
  surface: ReviewSurface;
  reason: ReviewReasonFilter;
  filtered: boolean;
  skippedWaiting: number;
  onSkipped: () => void;
  onHistory: () => void;
}) {
  if (surface === "history") {
    return {
      title: "No closed items yet",
      body: "Confirmed pairs and dismissed parse issues will appear here.",
    };
  }
  if (reason === "skipped") {
    return {
      title: "Nothing skipped",
      body: "Skip for now holds items here so you can come back. They stay Open until you act.",
    };
  }
  if (filtered) {
    return {
      title: "Nothing in this view",
      body: "Try another account, date, or reason. Open items are still in the list when the filter matches.",
    };
  }
  if (skippedWaiting > 0) {
    return {
      title: "All caught up",
      body: `${skippedWaiting} skipped ${skippedWaiting === 1 ? "item is" : "items are"} waiting in Skipped. Open that filter to act or send them back.`,
      actions: (
        <TextButton onClick={onSkipped}>View skipped</TextButton>
      ),
    };
  }
  return {
    title: "All caught up",
    body: "Open is clear. New unpaired transfers, refunds, and uncategorised spend will show up here when they need a decision.",
    note: "Money-trust items never auto-dismiss — check History for what you already confirmed.",
    actions: (
      <>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-sm font-semibold text-on-primary shadow-card"
        >
          Back to Dashboard
        </Link>
        <button
          type="button"
          onClick={onHistory}
          className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-line bg-surface px-4 text-sm font-semibold text-ink"
        >
          See History
        </button>
      </>
    ),
  };
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded-[2px] px-3 text-[13px] font-semibold ${
        active ? "bg-primary text-on-primary" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-sm font-semibold text-on-primary shadow-card"
    >
      {children}
    </button>
  );
}

function SkipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 5v14l11-7L5 5z" />
      <path d="M19 5v14" />
    </svg>
  );
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
