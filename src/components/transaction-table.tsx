"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatSignedAud } from "@/lib/format";
import { allTags, tagsOf } from "@/lib/money-flow/tags";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

type Direction = "all" | "in" | "out";

export function TransactionTable({ transactions }: { transactions: InterpretedTransaction[] }) {
  const { setTransactionTags } = useMoneyFlow();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("All");
  const [direction, setDirection] = useState<Direction>("all");
  const tagOptions = useMemo(() => ["All", ...allTags(transactions)], [transactions]);
  const activeTag = tagOptions.includes(tag) ? tag : "All";

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((txn) => {
      const tags = tagsOf(txn);
      const matchesTag = activeTag === "All" || tags.some((name) => name === activeTag);
      const matchesDirection =
        direction === "all" || (direction === "in" ? txn.amount > 0 : txn.amount < 0);
      const matchesQuery =
        needle.length === 0 ||
        txn.merchant.toLowerCase().includes(needle) ||
        tags.some((name) => name.toLowerCase().includes(needle)) ||
        txn.sourceFile.toLowerCase().includes(needle);
      return matchesTag && matchesDirection && matchesQuery;
    });
  }, [activeTag, direction, query, transactions]);

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search merchants, tags, or files"
          className="w-full rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31] sm:max-w-xs"
        />
        <select
          value={activeTag}
          onChange={(event) => setTag(event.target.value)}
          aria-label="Filter by tag"
          className="rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
        >
          {tagOptions.map((name) => (
            <option key={name} value={name}>
              {name === "All" ? "All tags" : name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["in", "Money in"],
              ["out", "Money out"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                direction === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 divide-y divide-[#edf0ee]">
        {rows.length === 0 ? (
          <p className="py-8 text-sm text-[#60716a]">
            {transactions.length === 0 ? "No movements in this period." : "No transactions match that search."}
          </p>
        ) : (
          rows.map((txn) => (
            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between" key={txn.id}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{txn.merchant}</p>
                <p className="mt-1 text-sm text-[#77857f]">{txn.date}</p>
                <TagEditor
                  tags={tagsOf(txn)}
                  aiSuggested={txn.tagSource === "ai"}
                  suggestions={allTags(transactions)}
                  listId={`tag-suggestions-${txn.id}`}
                  onChange={(next) => setTransactionTags(txn.id, next)}
                />
              </div>
              <p className={`font-semibold sm:pt-0.5 ${txn.amount > 0 ? "text-[#257155]" : ""}`}>
                {formatSignedAud(txn.amount)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TagEditor({
  tags,
  aiSuggested = false,
  suggestions,
  listId,
  onChange,
}: {
  tags: string[];
  aiSuggested?: boolean;
  suggestions: string[];
  listId: string;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const unused = suggestions.filter((name) => !tags.some((tag) => tag.toLowerCase() === name.toLowerCase()));

  function add(name: string) {
    const next = name.trim();
    if (!next) return;
    onChange([...tags, next]);
    setDraft("");
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f]">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((name) => name !== tag))}
            className="text-[#527166] hover:text-[#173b31]"
          >
            ×
          </button>
        </span>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          add(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          list={listId}
          placeholder="Add tag"
          className="w-28 rounded-full border border-[#dce4df] bg-white px-3 py-1 text-xs outline-none focus:border-[#173b31]"
        />
        <button type="submit" className="text-xs font-semibold text-[#355a3f]">
          Add
        </button>
      </form>
      {aiSuggested ? (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#527166]">AI suggested</span>
      ) : null}
      {unused.length > 0 ? (
        <select
          value=""
          aria-label="Add existing tag"
          onChange={(event) => {
            if (event.target.value) add(event.target.value);
          }}
          className="rounded-full border border-[#dce4df] bg-white px-2 py-1 text-xs outline-none focus:border-[#173b31]"
        >
          <option value="">Existing tags</option>
          {unused.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      <datalist id={listId}>
        {unused.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
