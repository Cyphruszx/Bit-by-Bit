"use client";

import { useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";
import { pickerGroups } from "@/lib/money-flow/category-book";
import { canDismiss, type ReviewItem, type ReviewReason } from "@/lib/money-flow/review-queue";
import { UNCATEGORISED } from "@/lib/money-flow/taxonomy";

const SHOWN = 8;

const REASON_LABEL: Record<ReviewReason, string> = {
  UNPAIRED_TRANSFER: "Unpaired transfer",
  PARTIAL_REFUND: "Partial refund",
  FULL_REFUND_AMBIGUOUS: "Refund to confirm",
  DUPLICATE_HOLD: "Duplicate hold",
  UNREVIEWED_KIND: "Needs a category",
  INGEST_PARSE: "Couldn't read a file",
  FINGERPRINT_CONFLICT: "Fingerprint conflict",
  RULE_CONFLICT: "Rule conflict",
  AI_LOW_CONFIDENCE: "AI wasn't sure",
};

/**
 * Spec 7 Review Queue. Badge and this card both read OPEN count. "Everything
 * is sorted" only when that count is zero. Money-trust items cannot be dismissed.
 */
export function ReviewQueue() {
  const {
    confirmReviewRefund,
    confirmReviewTransfer,
    declineReviewItem,
    dismissReviewItem,
    openReviewCount,
    review,
    setMerchantCategory,
  } = useMoneyFlow();
  const [open, setOpen] = useState(false);
  const items = review.filter((item) => item.state === "OPEN");

  if (items.length === 0) {
    if (openReviewCount !== 0) return null;
    return (
      <article className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-base font-bold">Everything is sorted</h2>
        <p className="mt-0.5 text-xs text-muted">The Review Queue is clear — nothing is OPEN.</p>
      </article>
    );
  }

  const shown = open ? items : items.slice(0, SHOWN);

  return (
    <article className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Review queue</h2>
          <p className="mt-0.5 text-xs text-muted">
            {formatCount(openReviewCount)} OPEN. Money-trust items stay out of Income, Spending,
            Refund credits and Net until you confirm them. Only a failed import can be dismissed.
          </p>
        </div>
        <p className="shrink-0 text-xs font-semibold text-ink-soft">{formatCount(openReviewCount)} OPEN</p>
      </div>

      <ul className="mt-3 divide-y divide-surface-subtle">
        {shown.map((item) => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={item.id}>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {REASON_LABEL[item.reason]}
              </p>
              <p className="truncate text-sm font-semibold">{item.label}</p>
            </div>
            <ReviewActions
              item={item}
              onCategory={(merchant, categoryKey) => setMerchantCategory(merchant, categoryKey)}
              onConfirmRefund={() => confirmReviewRefund(item)}
              onConfirmTransfer={() => confirmReviewTransfer(item)}
              onDecline={() => declineReviewItem(item)}
              onDismiss={() => dismissReviewItem(item)}
            />
          </li>
        ))}
      </ul>

      {items.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-2 rounded-full bg-accent-surface px-2.5 py-1 text-xs font-semibold text-ink-soft"
        >
          {open ? "Show fewer" : `Show all ${formatCount(items.length)}`}
        </button>
      ) : null}
    </article>
  );
}

function ReviewActions({
  item,
  onCategory,
  onConfirmRefund,
  onConfirmTransfer,
  onDecline,
  onDismiss,
}: {
  item: ReviewItem;
  onCategory: (merchant: string, categoryKey: string) => void;
  onConfirmRefund: () => void;
  onConfirmTransfer: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  if (item.reason === "UNREVIEWED_KIND") {
    const merchant = item.label.replace(/ needs a category$/i, "");
    return (
      <label className="flex shrink-0 items-center gap-1.5">
        <span className="sr-only">Category for {merchant}</span>
        <select
          value={UNCATEGORISED}
          onChange={(event) => {
            if (event.target.value !== UNCATEGORISED) onCategory(merchant, event.target.value);
          }}
          className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs outline-none focus:border-primary"
        >
          <option value={UNCATEGORISED}>Choose a category</option>
          {pickerGroups().map((held) => (
            <optgroup key={held.id} label={held.label}>
              {held.categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
  }

  if (canDismiss(item.reason)) {
    return (
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full bg-accent-surface px-2.5 py-1 text-xs font-semibold text-ink-soft"
      >
        Dismiss
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap gap-1.5">
      {item.reason === "UNPAIRED_TRANSFER" && item.debitId && item.creditId ? (
        <button
          type="button"
          onClick={onConfirmTransfer}
          className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white"
        >
          Confirm transfer
        </button>
      ) : null}
      {(item.reason === "PARTIAL_REFUND" || item.reason === "FULL_REFUND_AMBIGUOUS") &&
      item.debitId &&
      item.creditId ? (
        <button
          type="button"
          onClick={onConfirmRefund}
          className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white"
        >
          Confirm refund
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDecline}
        className="rounded-full bg-accent-surface px-2.5 py-1 text-xs font-semibold text-ink-soft"
      >
        Not that
      </button>
    </div>
  );
}
