"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  addBankCategory,
  addCategory,
  addGroup,
  categoriesIn,
  moveCategory,
  removeBankCategory,
  removeCategory,
  removeGroup,
  renameBankCategory,
  renameCategory,
  renameGroup,
  type BookCategory,
  type CategoryBook,
} from "@/lib/money-flow/category-book";
import { formatCount } from "@/lib/format";
import type { InterpretedTransaction } from "@/lib/money-flow/types";

export function CategoryBookEditor({
  book,
  onChange,
  transactions,
  allTransactions,
  hasUploads,
}: {
  book: CategoryBook;
  onChange: (book: CategoryBook | null) => void;
  transactions: InterpretedTransaction[];
  allTransactions: InterpretedTransaction[];
  hasUploads: boolean;
}) {
  const [addingGroup, setAddingGroup] = useState(false);
  const counts = useMemo(() => countByCategory(transactions), [transactions]);
  const seen = useMemo(() => bankLabelsByCategory(allTransactions), [allTransactions]);

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {addingGroup ? (
          <NameForm
            placeholder="Group name"
            submitLabel="Add group"
            onCancel={() => setAddingGroup(false)}
            onSubmit={(name) => {
              onChange(addGroup(book, name));
              setAddingGroup(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            className="rounded-full bg-[#173b31] px-4 py-1.5 text-sm font-semibold text-white"
          >
            Add group
          </button>
        )}
      </div>

      {book.groups.map((group) => {
        const held = categoriesIn(book, group.id);
        return (
          <GroupCard
            key={group.id}
            book={book}
            groupId={group.id}
            label={group.label}
            categories={held}
            counts={counts}
            seen={seen}
            hasUploads={hasUploads}
            onChange={onChange}
          />
        );
      })}

      <p className="pt-2 text-sm text-[#77857f]">
        <button
          type="button"
          className="font-semibold text-[#355a3f] underline"
          onClick={() => {
            if (window.confirm("Restore the usual categories, groups, and bank labels?")) {
              onChange(null);
            }
          }}
        >
          Restore the usual categories
        </button>
      </p>
    </div>
  );
}

function GroupCard({
  book,
  groupId,
  label,
  categories,
  counts,
  seen,
  hasUploads,
  onChange,
}: {
  book: CategoryBook;
  groupId: string;
  label: string;
  categories: BookCategory[];
  counts: Map<string, number>;
  seen: Map<string, string[]>;
  hasUploads: boolean;
  onChange: (book: CategoryBook) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const canRemove = categories.every((category) => !category.builtin);

  return (
    <section className="rounded-2xl border border-[#dce4df] bg-white">
      <header className="flex flex-wrap items-center gap-2 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`group-${groupId}`}
          onClick={() => setOpen((held) => !held)}
          className="rounded-full px-2 py-1 text-xs font-semibold text-[#527166] hover:bg-[#edf4dc]"
        >
          {open ? "Hide" : "Show"}
        </button>
        <EditableLabel
          value={label}
          ariaLabel={`Group name, ${label}`}
          className="text-lg font-bold"
          onSave={(next) => onChange(renameGroup(book, groupId, next))}
        />
        <span className="text-sm text-[#77857f]">{categoryCount(categories.length)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {adding ? (
            <NameForm
              placeholder="Category name"
              submitLabel="Add category"
              onCancel={() => setAdding(false)}
              onSubmit={(name) => {
                onChange(addCategory(book, groupId, name));
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-sm font-semibold text-[#355a3f]"
            >
              Add category
            </button>
          )}
          {canRemove ? (
            <button
              type="button"
              onClick={() => onChange(removeGroup(book, groupId))}
              className="text-sm font-semibold text-[#8a5a1e]"
            >
              Remove group
            </button>
          ) : null}
        </div>
      </header>
      {open ? (
        <div id={`group-${groupId}`} className="border-t border-[#edf0ee] px-5 py-2">
          {categories.length === 0 ? (
            <p className="py-4 text-sm text-[#60716a]">No categories in this group yet.</p>
          ) : (
            categories.map((category) => (
              <CategoryBlock
                key={category.key}
                book={book}
                category={category}
                movements={counts.get(category.key) ?? 0}
                seen={seen.get(category.key) ?? []}
                hasUploads={hasUploads}
                onChange={onChange}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function CategoryBlock({
  book,
  category,
  movements,
  seen,
  hasUploads,
  onChange,
}: {
  book: CategoryBook;
  category: BookCategory;
  movements: number;
  seen: string[];
  hasUploads: boolean;
  onChange: (book: CategoryBook) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const unusedSeen = seen.filter(
    (name) => !category.bankCategories.some((held) => held.toLowerCase() === name.toLowerCase()),
  );

  return (
    <article className="border-b border-[#edf0ee] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`category-${category.key}`}
          onClick={() => setOpen((held) => !held)}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#527166] hover:bg-[#edf4dc]"
        >
          {open ? "Hide" : "Show"}
        </button>
        <EditableLabel
          value={category.label}
          ariaLabel={`Category name, ${category.label}`}
          className="font-semibold"
          onSave={(next) => onChange(renameCategory(book, category.key, next))}
        />
        <span className="text-xs text-[#77857f]">{bankCount(category.bankCategories.length)}</span>
        {hasUploads ? (
          <span className="text-xs text-[#77857f]">
            {movements === 0 ? "No movements in this period" : `${formatCount(movements)} in this period`}
          </span>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[#77857f]">
          Group
          <select
            value={category.groupId}
            aria-label={`Group for ${category.label}`}
            onChange={(event) => onChange(moveCategory(book, category.key, event.target.value))}
            className="rounded-full border border-[#dce4df] bg-white px-2 py-0.5 text-[11px] outline-none focus:border-[#173b31]"
          >
            {book.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        {!category.builtin ? (
          <button
            type="button"
            title={movements > 0 ? "Remove after re-filing the movements that use this category" : "Remove category"}
            disabled={movements > 0}
            onClick={() => onChange(removeCategory(book, category.key))}
            className="text-xs font-semibold text-[#8a5a1e] disabled:opacity-40"
          >
            Remove
          </button>
        ) : null}
      </div>
      {open ? (
        <div id={`category-${category.key}`} className="mt-2 pl-2 sm:pl-8">
          {category.bankCategories.length === 0 && unusedSeen.length === 0 ? (
            <p className="text-xs text-[#77857f]">No bank categories mapped yet.</p>
          ) : null}
          <ul className="space-y-1">
            {category.bankCategories.map((name) => (
              <li key={name} className="flex flex-wrap items-center gap-2">
                <EditableLabel
                  value={name}
                  ariaLabel={`Bank category, ${name}`}
                  className="text-sm text-[#355a3f]"
                  onSave={(next) => onChange(renameBankCategory(book, category.key, name, next))}
                />
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(removeBankCategory(book, category.key, name))}
                  className="text-xs font-semibold text-[#77857f] hover:text-[#173b31]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {unusedSeen.length > 0 ? (
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#77857f]">
                Seen in your statements
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {unusedSeen.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onChange(addBankCategory(book, category.key, name))}
                    className="rounded-full bg-[#f4f8ec] px-2 py-0.5 text-[11px] font-semibold text-[#355a3f]"
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-2">
            {adding ? (
              <NameForm
                placeholder="Bank category"
                submitLabel="Add"
                onCancel={() => setAdding(false)}
                onSubmit={(name) => {
                  onChange(addBankCategory(book, category.key, name));
                  setAdding(false);
                }}
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-[#355a3f]">
                Add bank category
              </button>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EditableLabel({
  value,
  onSave,
  className,
  ariaLabel,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function save() {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        title="Click to rename"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className={`rounded px-0.5 text-left hover:bg-[#edf4dc] ${className ?? ""}`}
      >
        {value}
      </button>
    );
  }

  return (
    <form
      className="min-w-[8rem] flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        value={draft}
        aria-label={ariaLabel}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        className={`w-full rounded-full border border-[#dce4df] bg-white px-2.5 py-0.5 outline-none focus:border-[#173b31] ${className ?? ""}`}
      />
    </form>
  );
}

function NameForm({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    onSubmit(next);
  }

  return (
    <form className="flex flex-wrap items-center gap-1.5" onSubmit={submit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        className="w-40 rounded-full border border-[#dce4df] bg-white px-2.5 py-1 text-sm outline-none focus:border-[#173b31]"
      />
      <button type="submit" className="rounded-full bg-[#173b31] px-3 py-1 text-xs font-semibold text-white">
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-[#60716a]">
        Cancel
      </button>
    </form>
  );
}

function countByCategory(transactions: InterpretedTransaction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const txn of transactions) {
    counts.set(txn.categoryKey, (counts.get(txn.categoryKey) ?? 0) + 1);
  }
  return counts;
}

function bankLabelsByCategory(transactions: InterpretedTransaction[]): Map<string, string[]> {
  const held = new Map<string, string[]>();
  for (const txn of transactions) {
    const label = txn.bank?.category?.trim();
    if (!label) continue;
    const list = held.get(txn.categoryKey) ?? [];
    if (!list.some((name) => name.toLowerCase() === label.toLowerCase())) list.push(label);
    held.set(txn.categoryKey, list);
  }
  for (const list of held.values()) list.sort((a, b) => a.localeCompare(b));
  return held;
}

function categoryCount(count: number): string {
  return count === 1 ? "1 category" : `${count} categories`;
}

function bankCount(count: number): string {
  return count === 1 ? "1 bank category" : `${count} bank categories`;
}
