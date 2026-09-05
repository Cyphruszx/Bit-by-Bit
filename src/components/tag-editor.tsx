"use client";

import { useState, type ReactNode } from "react";
import { tagsOf } from "@/lib/money-flow/tags";
import {
  categoryLabel,
  categoryPath,
  CATEGORY_KEYS,
  groupOf,
  typeLabel,
  UNCATEGORISED,
} from "@/lib/money-flow/taxonomy";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

/**
 * What a movement was, at a glance.
 *
 * The old control read `PRIMARY [tag] Change prim | Set [Existing] | SUB Optional`, which
 * asked a person to understand a data model before they could correct a shop. There is one
 * category now and it is picked from a list, so there is nothing to explain.
 */
export function ClassificationChips({ txn }: { txn: InterpretedTransaction }) {
  const tags = tagsOf(txn);
  const unsorted = txn.categoryKey === UNCATEGORISED;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          unsorted ? "bg-[#fdf2e3] text-[#8a5a1e]" : "bg-[#173b31] text-white"
        }`}
      >
        {categoryPath(txn.categoryKey)}
      </span>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full bg-[#edf4dc] px-2 py-0.5 text-[11px] font-semibold text-[#355a3f]"
        >
          {tag}
        </span>
      ))}
      <Provenance txn={txn} />
    </div>
  );
}

/**
 * Where this classification came from, said plainly.
 *
 * A suggestion and a decision used to look identical, so a person had no way to tell what
 * still needed their attention. Only the states that mean "somebody should look" are shown
 * — a rule quietly getting it right needs no badge.
 */
function Provenance({ txn }: { txn: InterpretedTransaction }) {
  if (txn.decidedBy === "said") {
    return <Note tone="settled">You chose this</Note>;
  }
  if (txn.decidedBy === "ai") return <Note tone="offered">AI suggestion</Note>;
  if (txn.decidedBy === "paired") {
    return <Note tone="settled">{txn.transferPair ? "Matched to your other account" : "Matched to a payment"}</Note>;
  }
  if (txn.categoryKey === UNCATEGORISED) return <Note tone="offered">Needs a category</Note>;
  return null;
}

function Note({ tone, children }: { tone: "settled" | "offered"; children: ReactNode }) {
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide ${
        tone === "settled" ? "text-[#527166]" : "text-[#8a5a1e]"
      }`}
    >
      {children}
    </span>
  );
}

export function ClassificationEditor({
  txn,
  tagOptions,
  listId,
  onCategory,
  onTags,
}: {
  txn: InterpretedTransaction;
  tagOptions: string[];
  listId: string;
  onCategory: (categoryKey: string) => void;
  onTags: (tags: string[]) => void;
}) {
  const tags = tagsOf(txn);
  const unused = tagOptions.filter((name) => !tags.some((tag) => tag.toLowerCase() === name.toLowerCase()));

  return (
    <div className="space-y-2">
      <Field label="Category">
        <select
          value={txn.categoryKey}
          aria-label="Category"
          onChange={(event) => onCategory(event.target.value)}
          className="rounded-full border border-[#dce4df] bg-white px-2.5 py-1 text-[11px] outline-none focus:border-[#173b31]"
        >
          {CATEGORY_KEYS.map((key) => (
            <option key={key} value={key}>
              {key.includes(".") ? `  ${categoryLabel(key)}` : categoryLabel(key)}
            </option>
          ))}
        </select>
        {/* The type is not a field. It follows from the category and which way the money
            went, so showing it as editable would invite the two to disagree. */}
        <span className="text-[11px] text-[#77857f]">
          Counts as <strong className="font-semibold text-[#355a3f]">{typeLabel(txn.type).toLowerCase()}</strong>
        </span>
      </Field>

      <Field label="Tags">
        {tags.length === 0 ? <span className="text-[11px] text-[#77857f]">Optional</span> : null}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-[#edf4dc] px-2 py-0.5 text-[11px] font-semibold text-[#355a3f]"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onTags(tags.filter((name) => name !== tag))}
              className="text-[#527166] hover:text-[#173b31]"
            >
              ×
            </button>
          </span>
        ))}
        <TagNameForm
          listId={listId}
          options={unused}
          onSubmit={(name) => {
            if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) return;
            onTags([...tags, name]);
          }}
        />
      </Field>

      {txn.bank?.category ? (
        <p className="text-[11px] text-[#77857f]">
          Your bank called this <span className="font-semibold">{txn.bank.category}</span>. Kept for reference only.
        </p>
      ) : null}
    </div>
  );
}

/** The groups present, for the filter chips. Keyed, so a rename cannot orphan a selection. */
export function groupsOf(transactions: InterpretedTransaction[]): string[] {
  return [...new Set(transactions.map((txn) => groupOf(txn.categoryKey)))].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b)),
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#77857f]">{label}</span>
      {children}
    </div>
  );
}

function TagNameForm({
  listId,
  options,
  onSubmit,
}: {
  listId: string;
  options: string[];
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit(name: string) {
    const next = name.trim();
    if (!next) return;
    onSubmit(next);
    setDraft("");
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        list={listId}
        placeholder="Add a tag"
        className="w-24 rounded-full border border-[#dce4df] bg-white px-2 py-0.5 text-[11px] outline-none focus:border-[#173b31]"
      />
      <button type="submit" className="text-xs font-semibold text-[#355a3f]">
        Add
      </button>
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </form>
  );
}
