"use client";

import { type ReactNode } from "react";
import { groupLabelOf } from "@/lib/money-flow/category-book";
import { tagsOf } from "@/lib/money-flow/tags";
import { categoryLabel, UNCATEGORISED } from "@/lib/money-flow/taxonomy";
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
  const group = groupLabelOf(txn.categoryKey);
  const category = categoryLabel(txn.categoryKey);
  const showCategory = group.toLowerCase() !== category.toLowerCase();

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          unsorted ? "bg-[#fdf2e3] text-[#8a5a1e]" : "bg-[#173b31] text-white"
        }`}
      >
        {group}
      </span>
      {showCategory ? (
        <span className="inline-flex items-center rounded-full bg-[#edf0ee] px-2 py-0.5 text-[11px] font-semibold text-[#173b31]">
          {category}
        </span>
      ) : null}
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
