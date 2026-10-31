"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BudgetRing } from "@/components/budget-ring";
import { formatAud } from "@/lib/format";
import {
  categoryRingAria,
  ringInsideText,
  type PlannedRing,
} from "@/lib/money-flow/budget-rings";

function finePointer(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

type TipPlace = {
  vertical: "top" | "bottom";
  horizontal: "start" | "center" | "end";
};

function placeTip(rect: DOMRect): TipPlace {
  const below = window.innerHeight - rect.bottom;
  const vertical = rect.top < 180 && below > rect.top ? "bottom" : "top";
  const horizontal = rect.left < 128 ? "start" : window.innerWidth - rect.right < 128 ? "end" : "center";
  return { vertical, horizontal };
}

export function RingDetailRows({ ring }: { ring: PlannedRing }) {
  const word = ring.over ? "Over" : "Left";
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[14px]">
      <dt className="text-muted">Spent</dt>
      <dd className="text-right tabular-nums">{formatAud(ring.spent)}</dd>
      <dt className="text-muted">Planned</dt>
      <dd className="text-right tabular-nums">{formatAud(ring.planned)}</dd>
      <dt className="text-muted">{word}</dt>
      <dd
        className={`text-right tabular-nums ${ring.over ? "font-bold text-primary-strong" : "text-ink"}`}
      >
        {formatAud(ring.remainder)}
      </dd>
    </dl>
  );
}

export function CategoryRingControl({
  ring,
  onOpenSheet,
}: {
  ring: PlannedRing;
  onOpenSheet: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<TipPlace | null>(null);
  const aria = categoryRingAria(ring.label, ring.spent, ring.planned);

  function showTip() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect || !finePointer()) return;
    setTip(placeTip(rect));
  }

  return (
    <div className="relative flex justify-center">
      <button
        ref={buttonRef}
        type="button"
        className="ring-hit flex w-full flex-col items-center gap-2 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onMouseEnter={showTip}
        onMouseLeave={() => setTip(null)}
        onFocus={showTip}
        onBlur={() => setTip(null)}
        onClick={() => {
          if (finePointer()) return;
          onOpenSheet();
        }}
      >
        <span className="text-center text-[14px] font-semibold text-ink" aria-hidden>
          {ring.label}
        </span>
        <BudgetRing
          planned={ring.planned}
          spent={ring.spent}
          figure="inside"
          digits="category"
          ariaLabel={aria}
          boxClassName="size-[88px] @min-[640px]:size-[104px]"
        />
      </button>
      {tip ? (
        <div
          aria-hidden
          className={`ui-card-surface pointer-events-none absolute z-30 w-[220px] p-3 ${
            tip.vertical === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } ${
            tip.horizontal === "center"
              ? "left-1/2 -translate-x-1/2"
              : tip.horizontal === "start"
                ? "left-0"
                : "right-0"
          }`}
        >
          <p className="mb-2 text-[14px] font-semibold text-ink">{ring.label}</p>
          <RingDetailRows ring={ring} />
        </div>
      ) : null}
    </div>
  );
}

export function CategoryDetailSheet({ ring, onClose }: { ring: PlannedRing; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-ink/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-sheet-title"
        className="ui-card-surface w-full px-5 pt-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
        style={{ borderRadius: "var(--card-radius) var(--card-radius) 0 0" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <BudgetRing
            planned={ring.planned}
            spent={ring.spent}
            figure="none"
            ariaLabel={categoryRingAria(ring.label, ring.spent, ring.planned)}
            boxClassName="size-14 shrink-0"
          />
          <div>
            <p id="category-sheet-title" className="text-[16px] font-semibold text-ink">
              {ring.label}
            </p>
            <p
              className={`text-[14px] ${ring.over ? "font-bold text-primary-strong" : "text-muted"}`}
            >
              {ringInsideText(ring.remainder, ring.over)}
            </p>
          </div>
        </div>
        <RingDetailRows ring={ring} />
        <div className="mt-4 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            className="ring-hit -my-2 inline-flex min-h-11 items-center px-2 text-[14px] font-semibold text-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
