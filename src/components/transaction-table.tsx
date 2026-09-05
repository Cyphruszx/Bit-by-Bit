"use client";

import { Fragment, useMemo, useState } from "react";
import { ClassificationChips } from "@/components/tag-editor";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount, formatSignedAud } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { accountIdOf, accountLabel } from "@/lib/money-flow/accounts";
import { displayName } from "@/lib/money-flow/display-name";
import { hasSource, sourcePairs } from "@/lib/money-flow/source";
import { allTags, merchantRows, tagsOf } from "@/lib/money-flow/tags";
import {
  categoriesIn,
  chartLabel,
  defaultCategoryForGroup,
  groupOf,
  resolvedBook,
  taxonomyPath,
} from "@/lib/money-flow/category-book";
import { categoryLabel, tagsFor, typeLabel } from "@/lib/money-flow/taxonomy";
import { matches, tableFilterKeys, tableFilterValue } from "@/lib/money-flow/summary";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

type Direction = "all" | "in" | "out";

const PAGE_SIZES = [5, 10, 25] as const;

const RULE = "border-r border-[#edf0ee]";
const CELL = "px-3 py-1.5";
const SELECT = "w-full bg-transparent outline-none text-xs text-[#17211e]";

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
  const columns = showAccount ? 8 : 7;
  const [query, setQuery] = useState("");
  const [internalTag, setInternalTag] = useState("All");
  const [direction, setDirection] = useState<Direction>("all");
  const [showStatement, setShowStatement] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  // Raised after every category edit where the merchant appears more than once, so the edit
  // can be carried across without the reader hunting the rest down one at a time.
  const [spread, setSpread] = useState<{ id: string; merchant: string; categoryKey: string; others: number } | null>(
    null,
  );
  const tagOptions = useMemo(
    () => ["All", ...tableFilterKeys(transactions), ...allTags(transactions)],
    [transactions],
  );
  const selectedTag = tag ?? internalTag;
  const activeTag = tableFilterValue(selectedTag, tagOptions);

  function selectTag(next: string) {
    if (onTagChange) onTagChange(next);
    else setInternalTag(next);
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return transactions.filter((txn) => {
      const tags = tagsOf(txn);
      const matchesTag =
        activeTag === "All" || matches(txn, activeTag) || tags.some((name) => name === activeTag);
      const matchesDirection =
        direction === "all" || (direction === "in" ? txn.amount > 0 : txn.amount < 0);
      const matchesQuery =
        needle.length === 0 ||
        displayName(txn).toLowerCase().includes(needle) ||
        txn.merchant.toLowerCase().includes(needle) ||
        taxonomyPath(txn.categoryKey).toLowerCase().includes(needle) ||
        tags.some((name) => name.toLowerCase().includes(needle)) ||
        txn.sourceFile.toLowerCase().includes(needle) ||
        (accountOf.get(txn.id) ?? "").toLowerCase().includes(needle) ||
        statementText(txn).includes(needle);
      return matchesTag && matchesDirection && matchesQuery;
    });
  }, [accountOf, activeTag, direction, query, transactions]);

  // Going back to the first page whenever the filter changes, so narrowing the list does not
  // leave the reader parked on a page of it that no longer means anything.
  const filterKey = `${activeTag}|${direction}|${query.trim().toLowerCase()}|${transactions.length}|${pageSize}`;
  const [shownFor, setShownFor] = useState(filterKey);
  if (shownFor !== filterKey) {
    setShownFor(filterKey);
    setPage(1);
  }
  const { items: visible, page: currentPage, pageCount, firstIndex: firstOnPage } = paginate(rows, page, pageSize);

  function applyCategory(txn: InterpretedTransaction, categoryKey: string) {
    if (categoryKey === txn.categoryKey) return;
    setTransactionCategory(txn.id, categoryKey);
    const others = merchantRows(allTransactions, txn.merchant).filter((row) => row.id !== txn.id).length;
    setSpread({ id: txn.id, merchant: displayName(txn), categoryKey, others });
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search merchants, categories, accounts, or statement cells"
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
              {name === "All" ? "Everything" : chartLabel(name)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={showStatement}
          onClick={() => setShowStatement((open) => !open)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            showStatement ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
          }`}
        >
          {showStatement ? "Hide statement" : "Show statement"}
        </button>
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
      {rows.length === 0 ? (
        <p className="mt-3 py-5 text-sm text-[#60716a]">
          {transactions.length === 0 ? "No movements in this period." : "No transactions match that search."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[#edf0ee]">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#f4f8ec]">
              <tr>
                <HeaderCell>Date</HeaderCell>
                <HeaderCell>Merchant</HeaderCell>
                <HeaderCell>Amount</HeaderCell>
                {showAccount ? <HeaderCell>Account</HeaderCell> : null}
                <HeaderCell>Type</HeaderCell>
                <HeaderCell>Group</HeaderCell>
                <HeaderCell>Category</HeaderCell>
                <HeaderCell last>Tag</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0ee] bg-white">
              {visible.map((txn) => {
                const book = resolvedBook();
                const groupId = groupOf(txn.categoryKey);
                const inGroup = categoriesIn(book, groupId);
                const categories = inGroup.some((category) => category.key === txn.categoryKey)
                  ? inGroup
                  : [{ key: txn.categoryKey, label: categoryLabel(txn.categoryKey) }, ...inGroup];
                const name = displayName(txn);
                return (
                  <Fragment key={txn.id}>
                    <tr>
                      <td className={`${CELL} ${RULE} whitespace-nowrap text-xs text-[#17211e]`}>{txn.date}</td>
                      <td className={`${CELL} ${RULE} text-xs font-medium text-[#17211e]`}>{name}</td>
                      <td
                        className={`${CELL} ${RULE} text-xs font-semibold tabular-nums ${
                          txn.amount > 0 ? "text-[#257155]" : "text-[#17211e]"
                        }`}
                      >
                        {formatSignedAud(txn.amount)}
                      </td>
                      {showAccount ? (
                        <td className={`${CELL} ${RULE} text-xs text-[#60716a]`}>{accountOf.get(txn.id)}</td>
                      ) : null}
                      <td className={`${CELL} ${RULE} text-[11px] font-semibold text-[#77857f]`}>{txn.type}</td>
                      <td className={`${CELL} ${RULE}`}>
                        <select
                          value={groupId}
                          aria-label={`Group for ${name}`}
                          onChange={(event) => applyCategory(txn, defaultCategoryForGroup(event.target.value, txn.categoryKey))}
                          className={SELECT}
                        >
                          {book.groups.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${CELL} ${RULE}`}>
                        <select
                          value={txn.categoryKey}
                          aria-label={`Category for ${name}`}
                          onChange={(event) => applyCategory(txn, event.target.value)}
                          className={SELECT}
                        >
                          {categories.map((held) => (
                            <option key={held.key} value={held.key}>
                              {held.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={CELL}>
                        <TagCell
                          tags={tagsOf(txn)}
                          options={[...new Set([...tagsFor(txn.categoryKey), ...allTags(transactions)])]}
                          listId={`tag-suggestions-${txn.id}`}
                          onChange={(next) => setTransactionTags(txn.id, next)}
                        />
                      </td>
                    </tr>
                    {showStatement ? (
                      <tr className="bg-[#fafcf9]">
                        <td colSpan={columns} className="px-3 py-2">
                          <ReadingBesideStatement txn={txn} />
                        </td>
                      </tr>
                    ) : null}
                    {spread?.id === txn.id ? (
                      <tr className="bg-[#f4f8ec]">
                        <td colSpan={columns} className="px-3 py-2 text-xs text-[#355a3f]" aria-live="polite">
                          Saved.{" "}
                          {spread.others === 0
                            ? `${spread.merchant} will be filed here from now on.`
                            : spread.others === 1
                              ? `Also applied to one other ${spread.merchant} movement, and to any that arrive later.`
                              : `Also applied to ${formatCount(spread.others)} other ${spread.merchant} movements, and to any that arrive later.`}{" "}
                          <span className="text-[#60716a]">You can undo this under What BitbyBit has learned.</span>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 ? (
        <nav aria-label="Transaction pages" className="mt-3 flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-1">
            {PAGE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={pageSize === size}
                aria-label={`${size} rows per page`}
                onClick={() => setPageSize(size)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  pageSize === size ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
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

function HeaderCell({ children, last = false }: { children: string; last?: boolean }) {
  return (
    <th
      className={`${CELL.replace("py-1.5", "py-2")} text-xs font-semibold uppercase tracking-wide text-[#527166] ${
        last ? "border-b border-[#edf0ee]" : `${RULE} border-b`
      }`}
    >
      {children}
    </th>
  );
}

function TagCell({
  tags,
  options,
  listId,
  onChange,
}: {
  tags: string[];
  options: string[];
  listId: string;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const unused = options.filter((name) => !tags.some((tag) => tag.toLowerCase() === name.toLowerCase()));

  function submit(name: string) {
    const next = name.trim();
    if (!next) return;
    if (tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...tags, next]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-full bg-[#edf4dc] px-2 py-0.5 text-[10px] font-semibold text-[#355a3f]"
        >
          {name}
          <button
            type="button"
            aria-label={`Remove ${name}`}
            onClick={() => onChange(tags.filter((tag) => tag !== name))}
            className="text-[#527166] hover:text-[#173b31]"
          >
            ×
          </button>
        </span>
      ))}
      <form
        className="flex items-center"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          list={listId}
          placeholder={tags.length === 0 ? "Add tag..." : "Add..."}
          aria-label="Add a tag"
          className={`border-b border-dashed border-[#c3d2ca] bg-transparent px-1 py-0.5 text-[11px] text-[#17211e] outline-none placeholder-[#77857f] ${
            tags.length === 0 ? "w-20" : "w-16"
          }`}
        />
        {unused.length > 0 ? (
          <datalist id={listId}>
            {unused.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}
      </form>
    </div>
  );
}

function statementText(txn: InterpretedTransaction): string {
  const cells = sourcePairs(txn.source)
    .map((cell) => `${cell.header} ${cell.value}`)
    .join(" ");
  const bank = [txn.bank?.category, txn.bank?.type, txn.bank?.merchant, txn.description]
    .filter(Boolean)
    .join(" ");
  return `${cells} ${bank}`.toLowerCase();
}

function ReadingBesideStatement({ txn }: { txn: InterpretedTransaction }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#527166]">BitbyBit</p>
        <p className="mt-1 text-[11px] text-[#60716a]">{typeLabel(txn.type)}</p>
        <div className="mt-1">
          <ClassificationChips txn={txn} />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#527166]">Statement</p>
        <StatementCells txn={txn} />
      </div>
    </div>
  );
}

function StatementCells({ txn }: { txn: InterpretedTransaction }) {
  const pairs = sourcePairs(txn.source);
  if (pairs.length > 0) {
    return (
      <dl className="mt-1 grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        {pairs.map((cell, index) => (
          <div className="contents" key={`${cell.header}-${index}`}>
            <dt className="truncate text-[#77857f]">{cell.header}</dt>
            <dd className="min-w-0 break-words text-[#355a3f]">{cell.value || "—"}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const fallback = [
    txn.bank?.category ? ["Category", txn.bank.category] : null,
    txn.bank?.type ? ["Type", txn.bank.type] : null,
    txn.bank?.merchant ? ["Merchant", txn.bank.merchant] : null,
    txn.description ? ["Details", txn.description] : null,
  ].filter((cell): cell is [string, string] => Boolean(cell));

  if (fallback.length > 0) {
    return (
      <dl className="mt-1 grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        {fallback.map(([header, value]) => (
          <div className="contents" key={header}>
            <dt className="truncate text-[#77857f]">{header}</dt>
            <dd className="min-w-0 break-words text-[#355a3f]">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <p className="mt-1 text-[11px] text-[#77857f]">
      {hasSource(txn.source)
        ? "The statement row is empty."
        : "Re-upload the statement to keep every original cell."}
    </p>
  );
}
