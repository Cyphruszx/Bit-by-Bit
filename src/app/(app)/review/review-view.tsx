"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud, formatSignedAud } from "@/lib/format";
import { accountCaption } from "@/lib/money-flow/account-identity";
import { accountsFrom } from "@/lib/money-flow/accounts";
import { pickerGroups } from "@/lib/money-flow/category-book";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { APP_TIME_ZONE } from "@/lib/money-flow/period";
import {
  filterReviewItems,
  hasOpenTransferItems,
  keepAsMoneyLabel,
  last30DaysSince,
  REVIEW_REASON_FILTERS,
  REVIEW_REASON_LABEL,
  reviewOpenedOn,
  reviewOpenActions,
  reviewMovementFacts,
  similarMovementPreviews,
  similarOpenUnpaired,
  skippedOpenCount,
  type ReviewOpenActionId,
  type ReviewReasonFilter,
  type ReviewSurface,
  type SimilarMovementPreview,
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

const CONFIDENCE_LABEL: Record<TransferConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ReviewView() {
  const {
    accountNames,
    allTransactions,
    assignReviewCategory,
    confirmReviewAsTransfer,
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
  } = useMoneyFlow();
  const [surface, setSurface] = useState<ReviewSurface>("open");
  const [reason, setReason] = useState<ReviewReasonFilter>("all");
  const [accountId, setAccountId] = useState<string | undefined>();
  const [last30, setLast30] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hideSameInstNote, setHideSameInstNote] = useState(false);

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
  const accounts = useMemo(() => accountsFrom(allTransactions, registry), [allTransactions, registry]);
  const byId = useMemo(() => new Map(allTransactions.map((txn) => [txn.id, txn])), [allTransactions]);
  const skippedCount = skippedOpenCount(review);
  const showSameInstNote =
    !hideSameInstNote &&
    hasOpenTransferItems(review.filter((item) => !isReviewDeferred(item))) &&
    surface === "open" &&
    reason !== "skipped";

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Review</h1>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SurfaceTab
          active={surface === "open"}
          onClick={() => setSurface("open")}
        >
          Open
        </SurfaceTab>
        <SurfaceTab
          active={surface === "history"}
          onClick={() => {
            setSurface("history");
            if (reason === "skipped") setReason("all");
          }}
        >
          History
        </SurfaceTab>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {REVIEW_REASON_FILTERS.filter((chip) => surface === "open" || chip.id !== "skipped").map((chip) => (
          <Chip key={chip.id} active={reason === chip.id} onClick={() => setReason(chip.id)}>
            {chip.label}
          </Chip>
        ))}
        <Chip
          active={Boolean(accountId) || accountOpen}
          onClick={() => {
            setAccountOpen(!accountOpen);
            if (accountId && accountOpen) setAccountId(undefined);
          }}
        >
          {accountId ? accounts.find((account) => account.id === accountId)?.label ?? "Account" : "Account"}
        </Chip>
        <Chip active={last30} onClick={() => setLast30(!last30)}>
          {last30 ? "Date · Last 30 days" : "Date"}
        </Chip>
      </div>

      {accountOpen ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip
            active={!accountId}
            subdued
            onClick={() => {
              setAccountId(undefined);
              setAccountOpen(false);
            }}
          >
            All
          </Chip>
          {accounts.map((account) => (
            <Chip
              key={account.id}
              active={accountId === account.id}
              subdued
              onClick={() => {
                setAccountId(account.id);
                setAccountOpen(false);
              }}
            >
              {account.label}
            </Chip>
          ))}
        </div>
      ) : null}

      <p className="mt-4 max-w-3xl text-sm text-muted">
        Money-trust items stay Open until you confirm or specify Not that — Dismiss is only for parse
        noise.
      </p>

      {showSameInstNote ? (
        <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft">
          <span>Same-institution unique pairs are matched automatically and not listed.</span>
          <button
            type="button"
            onClick={() => setHideSameInstNote(true)}
            className="rounded-full px-1.5 text-muted hover:text-ink"
            aria-label="Dismiss same-institution note"
          >
            ×
          </button>
        </div>
      ) : null}

      {items.length === 0 && surface === "open" && reason === "skipped" ? (
        <article className="card mt-6 p-[22px] text-center">
          <h2 className="text-lg font-bold">Nothing skipped</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Skip for now holds items here so you can come back. They stay Open until you act.
          </p>
        </article>
      ) : null}

      {items.length === 0 && surface === "open" && reason !== "skipped" ? (
        <article className="card mt-6 p-[22px] text-center">
          {skippedCount > 0 ? (
            <>
              <h2 className="text-lg font-bold">Nothing left in Open</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                {skippedCount} skipped {skippedCount === 1 ? "item is" : "items are"} waiting in
                Skipped. Open that filter to act or send them back.
              </p>
              <button
                type="button"
                onClick={() => setReason("skipped")}
                className="mt-4 rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-primary"
              >
                View skipped
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold">Nothing left to review</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Open is clear. New unpaired transfers, refunds, and uncategorised spend will show up
                here when they need a decision.
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                Money-trust items never auto-dismiss — check History for what you already confirmed.
              </p>
            </>
          )}
        </article>
      ) : null}

      {items.length === 0 && surface === "history" ? (
        <article className="card mt-6 p-[22px] text-center">
          <h2 className="text-lg font-bold">No closed items yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Confirmed pairs and dismissed parse issues will appear here.
          </p>
        </article>
      ) : null}

      <div className="mt-6 space-y-4">
        {items.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            byId={byId}
            history={surface === "history"}
            openedOn={reviewOpenedOn(item, allTransactions)}
            partners={transferPartnersFor(item, allTransactions, matching)}
            payments={refundPaymentsFor(item, allTransactions)}
            onAssignCategory={(merchant, categoryKey) => assignReviewCategory(item, merchant, categoryKey)}
            similar={similarOpenUnpaired(item, review, allTransactions, matching, registry)}
            onConfirmAsTransfer={(similar) => confirmReviewAsTransfer(item, similar)}
            onConfirmRefund={(debitId) => confirmReviewRefund(item, debitId)}
            onConfirmTransfer={(creditId) => confirmReviewTransfer(item, creditId)}
            onDecline={(partnerId) => declineReviewItem(item, partnerId)}
            onDismiss={() => dismissReviewItem(item)}
            onKeepAsMoney={(similar) => keepReviewAsMoney(item, similar)}
            onKeepFiling={() => keepReviewFiling(item)}
            onMarkIncome={() => markReviewIncome(item)}
            onSkip={() => skipReviewItem(item)}
            onUndefer={() => undeferReviewItem(item)}
            accountLabel={(id) => {
              const txn = byId.get(id);
              return txn ? accountCaption(txn, registry) : id;
            }}
          />
        ))}
      </div>
    </>
  );
}

function ReviewCard({
  item,
  byId,
  history,
  openedOn,
  partners,
  payments,
  similar,
  onAssignCategory,
  onConfirmAsTransfer,
  onConfirmRefund,
  onConfirmTransfer,
  onDecline,
  onDismiss,
  onKeepAsMoney,
  onKeepFiling,
  onMarkIncome,
  onSkip,
  onUndefer,
  accountLabel,
}: {
  item: ReviewItem;
  byId: Map<string, ReturnType<typeof useMoneyFlow>["allTransactions"][number]>;
  history: boolean;
  openedOn?: string;
  partners: TransferPartner[];
  payments: RefundPayment[];
  similar: ReviewItem[];
  onAssignCategory: (merchant: string, categoryKey: string) => void;
  onConfirmAsTransfer: (similar?: ReviewItem[]) => void;
  onConfirmRefund: (debitId?: string) => void;
  onConfirmTransfer: (creditId: string) => void;
  onDecline: (partnerId?: string) => void;
  onDismiss: () => void;
  onKeepAsMoney: (similar?: ReviewItem[]) => void;
  onKeepFiling: () => void;
  onMarkIncome: () => void;
  onSkip: () => void;
  onUndefer: () => void;
  accountLabel: (id: string) => string;
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
  const selectedPartner = partners.some((partner) => partner.id === pickedPartner)
    ? pickedPartner
    : partners[0]?.id;
  const selectedPayment = payments.some((payment) => payment.id === pickedPayment)
    ? pickedPayment
    : payments.length === 1
      ? payments[0]?.id
      : undefined;
  const merchant = item.label.replace(/ needs a category$/i, "");
  const facts = reviewMovementFacts(item, byId, accountLabel);
  const similarPreviews = similarMovementPreviews(similar, [...byId.values()]);
  const deferred = isReviewDeferred(item);

  return (
    <article className={`card p-[22px] ${history ? "bg-surface-subtle text-muted shadow-none" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-base font-bold ${history ? "text-ink-soft" : ""}`}>
            {history && item.reason === "UNPAIRED_TRANSFER" && item.state === "RESOLVED"
              ? "Paired transfer"
              : history && item.reason.includes("REFUND") && item.state === "RESOLVED"
                ? "Refund confirmed"
                : REVIEW_REASON_LABEL[item.reason]}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge muted={history}>{item.reason}</Badge>
            <Badge muted={history} strong={!history && item.state === "OPEN"}>
              {item.state}
            </Badge>
            {deferred ? <Badge muted={history}>Skipped</Badge> : null}
          </div>
          <p className="mt-2 text-xs text-muted">
            {item.state === "OPEN" ? "Opened" : item.state === "DISMISSED" ? "Dismissed" : "Confirmed"}
            {openedOn ? ` ${formatDisplayDate(openedOn)}` : ""}
            {item.label ? ` · ${item.label}` : ""}
          </p>
        </div>
      </div>

      {facts.length > 0 ? (
        <div className={`mt-4 grid gap-2 ${facts.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {facts.map((fact) => (
            <div key={fact.id} className="rounded-[var(--radius-inner)] bg-surface-subtle px-4 py-3">
              {facts.length > 1 ? (
                <p className="text-[10.5px] font-bold tracking-wide text-muted uppercase">
                  {fact.role === "out" ? "Out" : fact.role === "in" ? "In" : "Movement"}
                </p>
              ) : null}
              <p
                className={`text-xl font-bold tabular-nums ${fact.amount > 0 ? "text-positive" : ""} ${facts.length > 1 ? "mt-0.5" : ""}`}
              >
                {formatSignedAud(fact.amount)}
              </p>
              <p className="mt-1 text-sm font-semibold">{fact.account}</p>
              <p className="text-xs text-muted">
                {formatDisplayDate(fact.dateIso)} · {fact.merchant}
              </p>
              {fact.line !== fact.merchant ? (
                <p className="mt-0.5 text-xs text-ink-soft">{fact.line}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {item.reason === "UNPAIRED_TRANSFER" && !history && partners.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-bold">Suggested partners</p>
          <ul className="mt-2 space-y-2">
            {partners.map((partner) => {
              const active = selectedPartner === partner.id;
              return (
                <li key={partner.id}>
                  <button
                    type="button"
                    onClick={() => setPickedPartner(partner.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-inner)] border px-4 py-3 text-left ${
                      active ? "border-primary bg-surface" : "border-line bg-surface"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{partner.account}</p>
                      <p className="text-xs text-muted">
                        Deposit {formatAud(partner.amount)} · {formatDisplayDate(partner.dateIso)} ·{" "}
                        {partner.merchant}
                      </p>
                      {active ? (
                        <p className="mt-1 text-xs font-semibold text-ink-soft">
                          Expected credit {formatSignedAud(partner.amount)} · not a booked movement yet
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-accent-surface px-2.5 py-1 text-[11px] font-bold text-primary-strong">
                      {CONFIDENCE_LABEL[partner.confidence]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {(item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") && !history ? (
        <p className="mt-3 text-xs text-muted">
          Looks like a refund. Confirm to keep it as Refund, or mark as income if it is not.
        </p>
      ) : null}

      {(item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") &&
      !history &&
      payments.length > 1 ? (
        <div className="mt-4">
          <p className="text-sm font-bold">Matching payments</p>
          <ul className="mt-2 space-y-2">
            {payments.map((payment) => {
              const active = selectedPayment === payment.id;
              return (
                <li key={payment.id}>
                  <button
                    type="button"
                    onClick={() => setPickedPayment(payment.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-inner)] border px-4 py-3 text-left ${
                      active ? "border-primary bg-surface" : "border-line bg-surface"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{payment.merchant}</p>
                      <p className="text-xs text-muted">
                        {formatSignedAud(payment.amount)} · {formatDisplayDate(payment.dateIso)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {item.reason === "UNREVIEWED_KIND" && !history ? (
        <div className="mt-4">
          <p className="text-sm font-bold">{merchant}</p>
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
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  pickedCategory === category.key
                    ? "border-primary bg-accent-surface text-primary-strong"
                    : "border-line bg-surface text-ink-soft"
                }`}
              >
                {category.label}
              </button>
            ))}
            <label className="flex items-center">
              <span className="sr-only">Category for {merchant}</span>
              <select
                value={suggestions.some((category) => category.key === pickedCategory) ? UNCATEGORISED : (pickedCategory ?? UNCATEGORISED)}
                onChange={(event) => {
                  if (event.target.value !== UNCATEGORISED) setPickedCategory(event.target.value);
                }}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary"
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

      {item.reason === "INGEST_PARSE" ? (
        <p className="mt-3 text-sm">{item.label}</p>
      ) : null}

      {history ? null : (
        <ReviewActions
          item={item}
          partnerCount={partners.length}
          paymentCount={payments.length}
          selectedPartnerId={selectedPartner}
          selectedPaymentId={selectedPayment}
          selectedCategoryKey={pickedCategory}
          keepAsLabel={keepAsMoneyLabel(item, byId)}
          similarPreviews={partners.length === 0 ? similarPreviews : []}
          applySimilar={applySimilar}
          deferred={deferred}
          onApplySimilar={setApplySimilar}
          onAction={(action) => {
            const batch = applySimilar && similar.length > 1 ? similar : undefined;
            if (action === "confirm" && selectedPartner) onConfirmTransfer(selectedPartner);
            if (action === "confirm-as-transfer") onConfirmAsTransfer(batch);
            if (action === "confirm-refund") onConfirmRefund(selectedPayment);
            if (action === "mark-income") onMarkIncome();
            if (action === "keep-as-money") onKeepAsMoney(batch);
            if (action === "assign-category" && pickedCategory) onAssignCategory(merchant, pickedCategory);
            if (action === "skip") onSkip();
            if (action === "undefer") onUndefer();
            if (action === "dismiss") onDismiss();
            if (action === "not-that") onDecline(selectedPartner ?? selectedPayment);
            if (action === "keep-filing") onKeepFiling();
          }}
        />
      )}
    </article>
  );
}

function ReviewActions({
  item,
  partnerCount,
  paymentCount,
  selectedPartnerId,
  selectedPaymentId,
  selectedCategoryKey,
  keepAsLabel,
  similarPreviews,
  applySimilar,
  deferred,
  onApplySimilar,
  onAction,
}: {
  item: ReviewItem;
  partnerCount: number;
  paymentCount: number;
  selectedPartnerId?: string;
  selectedPaymentId?: string;
  selectedCategoryKey?: string;
  keepAsLabel: string;
  similarPreviews: SimilarMovementPreview[];
  applySimilar: boolean;
  deferred: boolean;
  onApplySimilar: (value: boolean) => void;
  onAction: (action: ReviewOpenActionId) => void;
}) {
  const actions = reviewOpenActions(item, {
    partnerCount,
    paymentCount,
    selectedPartnerId,
    selectedPaymentId,
    selectedCategoryKey,
    keepAsLabel,
    deferred,
  });
  const similarCount = similarPreviews.length;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!action.enabled}
            onClick={() => onAction(action.id)}
            className={`rounded-full px-4 py-2 text-xs ${
              action.role === "primary"
                ? "bg-primary font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
                : "border border-line bg-surface font-semibold text-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
            }`}
          >
            {action.label}
          </button>
        ))}
        {similarCount > 1 ? (
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={applySimilar}
              onChange={(event) => onApplySimilar(event.target.checked)}
              className="size-3.5 accent-[var(--color-primary)]"
            />
            Apply to {similarCount} similar
          </label>
        ) : null}
      </div>
      {similarCount > 1 ? (
        <ul className={`space-y-1.5 ${applySimilar ? "" : "opacity-60"}`}>
          {similarPreviews.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-soft">{row.line}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {formatDisplayDate(row.dateIso)} · {formatSignedAud(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SurfaceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
        active ? "bg-primary text-on-primary" : "bg-surface text-muted hover:bg-accent-surface"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  subdued = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  subdued?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 font-semibold ${subdued ? "text-xs" : "text-sm"} ${
        active ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  muted,
  strong,
}: {
  children: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide uppercase ${
        strong ? "bg-primary text-on-primary" : muted ? "bg-surface text-muted" : "bg-accent-surface text-primary-strong"
      }`}
    >
      {children}
    </span>
  );
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}
