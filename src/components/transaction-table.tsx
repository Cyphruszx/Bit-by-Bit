"use client";

import { useMemo, useState } from "react";
import { ClassificationChips, ClassificationEditor } from "@/components/tag-editor";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount, formatSignedAud } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { accountIdOf, accountLabel } from "@/lib/money-flow/accounts";
import { allTags, merchantRows, tagsOf } from "@/lib/money-flow/tags";
import { categoryLabel, categoryPath, groupOf } from "@/lib/money-flow/taxonomy";
import { selectableKeys } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

type Direction = "all" | "in" | "out";

/** A statement year runs to well over a thousand movements, which is more than anyone scrolls. */
const PAGE_SIZE = 25;

export function TransactionTable({
  transactions,
  tag,
  onTagChange,
}: {
  transactions: InterpretedTransaction[];
  tag?: string;
  onTagChange?: (tag: string) => void;
}) {
  const { accountNames, allTransactions, institutionOverrides, payers,
    setTransactionCategory, setTransactionTags } = useMoneyFlow();
  const registry = useMemo(
    () => ({ names: accountNames, institutions: institutionOverrides, payers }),
    [accountNames, institutionOverrides, payers],
  );
  const accountOf = useMemo(
    () => new Map(transactions.map((txn) => [txn.id, accountLabel(accountIdOf(txn, registry))])),
    [registry, transactions],
  );
  // Saying which account every movement is in only helps once there is more than one.
  const showAccount = new Set(accountOf.values()).size > 1;
  const [query, setQuery] = useState("");
  const [internalTag, setInternalTag] = useState("All");
  const [direction, setDirection] = useState<Direction>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Raised after every tag edit where the merchant appears more than once, so the edit can be
  // carried across without the reader hunting the rest down one at a time.
  const [spread, setSpread] = useState<{ id: string; merchant: string; categoryKey: string; others: number } | null>(
    null,
  );
  const tagOptions = useMemo(
    () => ["All", ...selectableKeys(transactions), ...allTags(transactions)],
    [transactions],
  );
  const selectedTag = tag ?? internalTag;
  const activeTag = tagOptions.includes(selectedTag) ? selectedTag : "All";

  function selectTag(next: string) {
    if (onTagChange) onTagChange(next);
    else setInternalTag(next);
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((txn) => {
      const tags = tagsOf(txn);
      const matchesTag =
        activeTag === "All" ||
        txn.categoryKey === activeTag ||
        groupOf(txn.categoryKey) === activeTag ||
        tags.some((name) => name === activeTag);
      const matchesDirection =
        direction === "all" || (direction === "in" ? txn.amount > 0 : txn.amount < 0);
      const matchesQuery =
        needle.length === 0 ||
        txn.merchant.toLowerCase().includes(needle) ||
        categoryPath(txn.categoryKey).toLowerCase().includes(needle) ||
        tags.some((name) => name.toLowerCase().includes(needle)) ||
        txn.sourceFile.toLowerCase().includes(needle) ||
        (accountOf.get(txn.id) ?? "").toLowerCase().includes(needle);
      return matchesTag && matchesDirection && matchesQuery;
    });
  }, [accountOf, activeTag, direction, query, transactions]);

  // Going back to the first page whenever the filter changes, so narrowing the list does not
  // leave the reader parked on a page of it that no longer means anything.
  const filterKey = `${activeTag}|${direction}|${query.trim().toLowerCase()}|${transactions.length}`;
  const [shownFor, setShownFor] = useState(filterKey);
  if (shownFor !== filterKey) {
    setShownFor(filterKey);
    setPage(1);
  }
  const { items: visible, page: currentPage, pageCount, firstIndex: firstOnPage } = paginate(rows, page, PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search merchants, categories, or accounts"
          className="w-full rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#173b31] sm:max-w-xs"
        />
        <select
          value={activeTag}
          onChange={(event) => selectTag(event.target.value)}
          aria-label="Filter by category or tag"
          className="rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#173b31]"
        >
          {tagOptions.map((name) => (
            <option key={name} value={name}>
              {name === "All" ? "Everything" : categoryLabel(name)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["in", "In"],
              ["out", "Out"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-label={value === "all" ? "All directions" : value === "in" ? "Money in" : "Money out"}
              onClick={() => setDirection(value)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                direction === value ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 divide-y divide-[#edf0ee]">
        {rows.length === 0 ? (
          <p className="py-5 text-sm text-[#60716a]">
            {transactions.length === 0 ? "No movements in this period." : "No transactions match that search."}
          </p>
        ) : (
          visible.map((txn) => {
            const editing = editingId === txn.id;
            return (
              <div className="py-2" key={txn.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <p className="text-sm font-semibold">{txn.merchant}</p>
                      <p className={`text-sm font-semibold tabular-nums ${txn.amount > 0 ? "text-[#257155]" : ""}`}>
                        {formatSignedAud(txn.amount)}
                      </p>
                      <p className="text-[11px] text-[#77857f]">{txn.date}</p>
                      {showAccount ? (
                        <p className="rounded-full bg-[#f0f4f1] px-2 py-0.5 text-[11px] text-[#60716a]">
                          {accountOf.get(txn.id)}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-1">
                      <ClassificationChips txn={txn} />
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-expanded={editing}
                    aria-controls={`tag-editor-${txn.id}`}
                    onClick={() => {
                      setSpread(null);
                      setEditingId(editing ? null : txn.id);
                    }}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      editing ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
                    }`}
                  >
                    {editing ? "Done" : "Change"}
                  </button>
                </div>
                <div
                  id={`tag-editor-${txn.id}`}
                  hidden={!editing}
                  className="mt-2 border-t border-dashed border-[#dce4df] pt-2"
                >
                  <ClassificationEditor
                    txn={txn}
                    tagOptions={allTags(transactions)}
                    listId={`tag-suggestions-${txn.id}`}
                    onTags={(next) => setTransactionTags(txn.id, next)}
                    onCategory={(categoryKey) => {
                      // Told once, applied everywhere, and said out loud. The app used to
                      // ask whether to carry a correction across — but the answer was
                      // always yes, and asking on every edit made a person confirm the
                      // same thing about the same shop over and over.
                      setTransactionCategory(txn.id, categoryKey);
                      const others = merchantRows(allTransactions, txn.merchant).filter(
                        (row) => row.id !== txn.id,
                      ).length;
                      setSpread({ id: txn.id, merchant: txn.merchant, categoryKey, others });
                    }}
                  />
                  {spread?.id === txn.id ? (
                    <p aria-live="polite" className="mt-2 rounded-xl bg-[#f4f8ec] px-3 py-2 text-xs text-[#355a3f]">
                      Saved.{" "}
                      {spread.others === 0
                        ? `${spread.merchant} will be filed here from now on.`
                        : spread.others === 1
                          ? `Also applied to one other ${spread.merchant} movement, and to any that arrive later.`
                          : `Also applied to ${formatCount(spread.others)} other ${spread.merchant} movements, and to any that arrive later.`}{" "}
                      <span className="text-[#60716a]">You can undo this under What BitbyBit has learned.</span>
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      {rows.length > PAGE_SIZE ? (
        <nav
          aria-label="Transaction pages"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0ee] pt-3"
        >
          <p className="text-xs text-[#60716a]" aria-live="polite">
            Showing {formatCount(firstOnPage + 1)}–{formatCount(firstOnPage + visible.length)} of{" "}
            {formatCount(rows.length)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <p className="text-xs font-semibold text-[#60716a]">
              Page {formatCount(currentPage)} of {formatCount(pageCount)}
            </p>
            <button
              type="button"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              className="rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
