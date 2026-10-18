"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import {
  chooseCustomRange,
  choosePeriod,
  customDateDraft,
  nextMenuIndex,
  periodMenuEntries,
  periodPickerLabel,
  type PeriodMenuChoice,
  type PeriodMenuEntry,
} from "@/lib/money-flow/period-picker";
import type { PeriodFilter } from "@/lib/money-flow/period";

const triggerClass =
  "inline-flex h-10 items-center gap-2 rounded-[var(--radius-card)] border-2 bg-surface px-3.5 font-sans text-sm font-semibold text-ink shadow-card outline-none focus-visible:border-primary";

export function PeriodPicker({
  months,
  period,
  onPeriod,
  anchor,
}: {
  months: string[];
  period: PeriodFilter;
  onPeriod: (period: PeriodFilter) => void;
  /** Month Last 12 months counts back from. */
  anchor: string;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"menu" | "custom">("menu");
  const [activeIndex, setActiveIndex] = useState(0);
  const [draft, setDraft] = useState(() => customDateDraft(period, anchor));
  const entries = periodMenuEntries(period, months, anchor);
  const label = periodPickerLabel(period);

  useEffect(() => {
    if (!open) {
      if (returnFocusRef.current) {
        returnFocusRef.current = false;
        buttonRef.current?.focus();
      }
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        returnFocusRef.current = false;
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      returnFocusRef.current = true;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (panel === "custom") {
      fromRef.current?.focus();
      return;
    }
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open, panel]);

  function close(returnFocus: boolean) {
    returnFocusRef.current = returnFocus;
    setOpen(false);
    setPanel("menu");
  }

  function openMenu() {
    const checked = entries.findIndex((entry) => entry.checked);
    setDraft(customDateDraft(period, anchor));
    setPanel("menu");
    setActiveIndex(checked >= 0 ? checked : 0);
    setOpen(true);
  }

  function choose(choice: PeriodMenuChoice) {
    if (choice.type === "custom") {
      setDraft(customDateDraft(period, anchor));
      setPanel("custom");
      return;
    }
    onPeriod(choosePeriod(choice, anchor));
    close(true);
  }

  function applyCustom() {
    const next = chooseCustomRange(draft.from, draft.to);
    if (!next) return;
    onPeriod(next);
    close(true);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const next = nextMenuIndex(activeIndex, entries.length, event.key);
    if (next == null) return;
    event.preventDefault();
    setActiveIndex(next);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={`${triggerClass} ${open ? "border-primary" : "border-line"}`}
        aria-label={`Period, ${label}`}
        aria-haspopup={open && panel === "custom" ? "dialog" : "menu"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span>{label}</span>
        <Chevron up={open} />
      </button>
      {open && panel === "menu" ? (
        <PeriodMenu
          id={menuId}
          entries={entries}
          activeIndex={activeIndex}
          onActiveIndex={setActiveIndex}
          onKeyDown={onMenuKeyDown}
          onChoose={choose}
          itemRef={(index, node) => {
            itemRefs.current[index] = node;
          }}
        />
      ) : null}
      {open && panel === "custom" ? (
        <CustomDatesPanel
          id={menuId}
          fromRef={fromRef}
          from={draft.from}
          to={draft.to}
          onFrom={(from) => setDraft((current) => ({ ...current, from }))}
          onTo={(to) => setDraft((current) => ({ ...current, to }))}
          onBack={() => {
            const customIndex = entries.findIndex((entry) => entry.type === "custom");
            setPanel("menu");
            setActiveIndex(customIndex >= 0 ? customIndex : 0);
          }}
          onApply={applyCustom}
        />
      ) : null}
    </div>
  );
}

export function PeriodMenu({
  id,
  entries,
  activeIndex,
  onActiveIndex,
  onKeyDown,
  onChoose,
  itemRef,
}: {
  id: string;
  entries: PeriodMenuEntry[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onChoose: (choice: PeriodMenuChoice) => void;
  itemRef: (index: number, node: HTMLButtonElement | null) => void;
}) {
  const headingId = useId();
  const row = (entry: PeriodMenuEntry, rowIndex: number) => (
    <MenuRow
      key={entry.type === "month" ? entry.month : entry.type}
      entry={entry}
      rowIndex={rowIndex}
      active={rowIndex === activeIndex}
      onActiveIndex={onActiveIndex}
      onChoose={onChoose}
      itemRef={itemRef}
    />
  );

  return (
    <div
      id={id}
      role="menu"
      aria-label="Period"
      onKeyDown={onKeyDown}
      className="card absolute right-0 top-[calc(100%+6px)] z-30 w-[min(260px,calc(100vw-2.5rem))] p-1.5"
    >
      <p id={headingId} className="px-3.5 pb-1 pt-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
        Month
      </p>
      <div role="group" aria-labelledby={headingId} className="max-h-[216px] overflow-y-auto overscroll-contain">
        {entries.map((entry, index) => (entry.type === "month" ? row(entry, index) : null))}
      </div>
      <div role="separator" className="mx-0 my-1 h-0.5 bg-line" />
      <div role="group" aria-label="Ranges">
        {entries.map((entry, index) =>
          entry.type === "last12" || entry.type === "all" ? row(entry, index) : null,
        )}
      </div>
      <div role="separator" className="mx-0 my-1 h-0.5 bg-line" />
      {entries.map((entry, index) => (entry.type === "custom" ? row(entry, index) : null))}
    </div>
  );
}

function MenuRow({
  entry,
  rowIndex,
  active,
  onActiveIndex,
  onChoose,
  itemRef,
}: {
  entry: PeriodMenuEntry;
  rowIndex: number;
  active: boolean;
  onActiveIndex: (index: number) => void;
  onChoose: (choice: PeriodMenuChoice) => void;
  itemRef: (index: number, node: HTMLButtonElement | null) => void;
}) {
  const checked = entry.checked;
  return (
    <button
      ref={(node) => itemRef(rowIndex, node)}
      type="button"
      role={entry.type === "custom" ? "menuitem" : "menuitemradio"}
      aria-checked={entry.type === "custom" ? undefined : checked}
      aria-current={entry.type === "custom" && checked ? "true" : undefined}
      tabIndex={active ? 0 : -1}
      className={`flex h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-inner)] px-3.5 text-left font-sans text-sm ${
        checked ? "bg-accent-surface font-semibold text-primary" : "font-normal text-ink hover:bg-surface-subtle"
      }`}
      onFocus={() => onActiveIndex(rowIndex)}
      onClick={() => onChoose(choiceFrom(entry))}
    >
      <span>{entry.label}</span>
      {checked ? <CheckIcon /> : null}
      {entry.type === "custom" && !checked ? <CalendarIcon /> : null}
    </button>
  );
}

export function CustomDatesPanel({
  id,
  fromRef,
  from,
  to,
  onFrom,
  onTo,
  onBack,
  onApply,
}: {
  id: string;
  fromRef: RefObject<HTMLInputElement | null>;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const canApply = Boolean(chooseCustomRange(from, to));
  return (
    <form
      id={id}
      role="dialog"
      aria-label="Custom dates"
      className="card absolute right-0 top-[calc(100%+6px)] z-30 flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <p className="font-sans text-[13px] font-bold text-ink">Custom dates</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <label className="grid gap-1 font-sans text-xs font-semibold text-muted">
          From
          <input
            ref={fromRef}
            type="date"
            value={from}
            onChange={(event) => onFrom(event.target.value)}
            className="h-10 w-full rounded-[var(--radius-card)] border-2 border-line bg-surface px-3 font-sans text-sm font-normal text-ink outline-none focus:border-primary"
          />
        </label>
        <span className="pb-2.5 font-sans text-base text-muted" aria-hidden>
          –
        </span>
        <label className="grid gap-1 font-sans text-xs font-semibold text-muted">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => onTo(event.target.value)}
            className="h-10 w-full rounded-[var(--radius-card)] border-2 border-line bg-surface px-3 font-sans text-sm font-normal text-ink outline-none focus:border-primary"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onBack} className="h-10 px-3.5 font-sans text-sm font-semibold text-ink-soft">
          Back
        </button>
        <button
          type="submit"
          disabled={!canApply}
          className="h-10 rounded-[var(--radius-card)] bg-primary px-4 font-sans text-sm font-semibold text-on-primary disabled:opacity-35"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

function choiceFrom(entry: PeriodMenuEntry): PeriodMenuChoice {
  if (entry.type === "month") return { type: "month", month: entry.month };
  if (entry.type === "last12") return { type: "last12" };
  if (entry.type === "all") return { type: "all" };
  return { type: "custom", from: "", to: "" };
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={up ? "text-primary" : "text-muted"}
    >
      {up ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-muted"
    >
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}
