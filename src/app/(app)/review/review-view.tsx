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
  last30DaysSince,
  REVIEW_REASON_FILTERS,
  REVIEW_REASON_LABEL,
  reviewOpenedOn,
  type ReviewReasonFilter,
  type ReviewSurface,
} from "@/lib/money-flow/review-page";
import {
  canDismiss,
  transferPartnersFor,
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
    confirmReviewRefund,
    confirmReviewTransfer,
    declineReviewItem,
    dismissReviewItem,
    institutionOverrides,
    mergedInto,
    payers,
    review,
    setMerchantCategory,
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
  const showSameInstNote = !hideSameInstNote && hasOpenTransferItems(review) && surface === "open";

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Review</h1>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SurfaceTab active={surface === "open"} onClick={() => setSurface("open")}>
          Open
        </SurfaceTab>
        <SurfaceTab active={surface === "history"} onClick={() => setSurface("history")}>
          History
        </SurfaceTab>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {REVIEW_REASON_FILTERS.map((chip) => (
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

      {items.length === 0 && surface === "open" ? (
        <article className="card mt-6 p-[22px] text-center">
          <h2 className="text-lg font-bold">Nothing left to review</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Open is clear. New unpaired transfers, refunds, and uncategorised spend will show up here
            when they need a decision.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Money-trust items never auto-dismiss — check History for what you already confirmed.
          </p>
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
            onCategory={(merchant, categoryKey) => setMerchantCategory(merchant, categoryKey)}
            onConfirmRefund={() => confirmReviewRefund(item)}
            onConfirmTransfer={(creditId) => confirmReviewTransfer(item, creditId)}
            onDecline={(creditId) => declineReviewItem(item, creditId)}
            onDismiss={() => dismissReviewItem(item)}
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
  onCategory,
  onConfirmRefund,
  onConfirmTransfer,
  onDecline,
  onDismiss,
  accountLabel,
}: {
  item: ReviewItem;
  byId: Map<string, ReturnType<typeof useMoneyFlow>["allTransactions"][number]>;
  history: boolean;
  openedOn?: string;
  partners: TransferPartner[];
  onCategory: (merchant: string, categoryKey: string) => void;
  onConfirmRefund: () => void;
  onConfirmTransfer: (creditId: string) => void;
  onDecline: (creditId?: string) => void;
  onDismiss: () => void;
  accountLabel: (id: string) => string;
}) {
  const debit = item.debitId ? byId.get(item.debitId) : undefined;
  const credit = item.creditId ? byId.get(item.creditId) : undefined;
  const [picked, setPicked] = useState<string | undefined>(item.creditId);
  const selected = partners.find((partner) => partner.id === picked);

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
          </div>
          <p className="mt-2 text-xs text-muted">
            {item.state === "OPEN" ? "Opened" : item.state === "DISMISSED" ? "Dismissed" : "Confirmed"}
            {openedOn ? ` ${formatDisplayDate(openedOn)}` : ""}
            {item.label ? ` · ${item.label}` : ""}
          </p>
        </div>
      </div>

      {item.reason === "UNPAIRED_TRANSFER" && debit ? (
        <div className="mt-4 rounded-[var(--radius-inner)] bg-surface-subtle px-4 py-3">
          <p className="text-2xl font-bold tabular-nums">{formatSignedAud(debit.amount)}</p>
          <p className="mt-1 text-sm font-semibold">{accountLabel(debit.id)}</p>
          <p className="text-xs text-muted">
            {formatDisplayDate(debit.dateIso)} · {debit.merchant}
          </p>
        </div>
      ) : null}

      {item.reason === "UNPAIRED_TRANSFER" && !history && partners.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-bold">Suggested partners</p>
          <ul className="mt-2 space-y-2">
            {partners.map((partner) => {
              const active = picked === partner.id;
              return (
                <li key={partner.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(partner.id)}
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

      {(item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") && credit ? (
        <div className="mt-4 rounded-[var(--radius-inner)] bg-surface-subtle px-4 py-3">
          <p className="text-2xl font-bold tabular-nums text-positive">{formatSignedAud(credit.amount)}</p>
          <p className="mt-1 text-sm font-semibold">{credit.merchant}</p>
          <p className="text-xs text-muted">
            {formatDisplayDate(credit.dateIso)}
            {debit ? ` · ${debit.merchant}` : ""}
          </p>
          {!history ? (
            <p className="mt-2 text-xs text-muted">
              Looks like a refund. Confirm to keep it as Refund, or leave it Open if it is not.
            </p>
          ) : null}
        </div>
      ) : null}

      {item.reason === "UNREVIEWED_KIND" && !history ? (
        <div className="mt-4 rounded-[var(--radius-inner)] bg-surface-subtle px-4 py-3">
          <p className="text-lg font-bold">{item.label.replace(/ needs a category$/i, "")}</p>
          <p className="text-xs text-muted">{item.movementIds.length} movement{item.movementIds.length === 1 ? "" : "s"}</p>
        </div>
      ) : null}

      {item.reason === "INGEST_PARSE" ? (
        <p className="mt-3 text-sm">{item.label}</p>
      ) : null}

      {history ? null : (
        <ReviewActions
          item={item}
          selectedCreditId={selected?.id}
          onCategory={onCategory}
          onConfirmRefund={onConfirmRefund}
          onConfirmTransfer={() => selected && onConfirmTransfer(selected.id)}
          onDecline={() => onDecline(selected?.id)}
          onDismiss={onDismiss}
        />
      )}
    </article>
  );
}

function ReviewActions({
  item,
  selectedCreditId,
  onCategory,
  onConfirmRefund,
  onConfirmTransfer,
  onDecline,
  onDismiss,
}: {
  item: ReviewItem;
  selectedCreditId?: string;
  onCategory: (merchant: string, categoryKey: string) => void;
  onConfirmRefund: () => void;
  onConfirmTransfer: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  if (item.reason === "UNREVIEWED_KIND") {
    const merchant = item.label.replace(/ needs a category$/i, "");
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {pickerGroups()
          .flatMap((group) => group.categories)
          .slice(0, 3)
          .map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => onCategory(merchant, category.key)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft"
            >
              {category.label}
            </button>
          ))}
        <label className="flex items-center">
          <span className="sr-only">Category for {merchant}</span>
          <select
            value={UNCATEGORISED}
            onChange={(event) => {
              if (event.target.value !== UNCATEGORISED) onCategory(merchant, event.target.value);
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
    );
  }

  if (canDismiss(item.reason)) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full bg-accent-surface px-4 py-2 text-xs font-semibold text-ink-soft"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const canConfirmTransfer = item.reason === "UNPAIRED_TRANSFER" && Boolean(selectedCreditId);
  const canConfirmRefund =
    (item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") &&
    Boolean(item.debitId && item.creditId);

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {canConfirmTransfer ? (
        <button
          type="button"
          onClick={onConfirmTransfer}
          className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-primary"
        >
          Confirm
        </button>
      ) : null}
      {canConfirmRefund ? (
        <button
          type="button"
          onClick={onConfirmRefund}
          className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-primary"
        >
          Confirm refund
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDecline}
        className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink-soft"
      >
        Not that
      </button>
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
