"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";
import {
  ARCHIVE_LEAVE_LABEL,
  ARCHIVE_LEAVE_NOTE,
  ARCHIVE_PLAN_NOTE,
  archiveIntro,
  archiveRefileLabel,
  archiveRulesNote,
  archiveTargetCategories,
  categoriesSummary,
  defaultArchiveTarget,
  deleteConfirmCopy,
  moveConfirmCopy,
  orderedFixedGroups,
  orderedYourGroups,
  plannedTotal,
  previewCategoryMove,
  transactionCountLabel,
  type ArchiveTarget,
} from "@/lib/money-flow/category-actions";
import {
  addCategory,
  addGroup,
  categoriesIn,
  isFixedGroup,
  isKnownGroup,
  removeGroup,
  renameCategory,
  renameGroup,
  type BookCategory,
  type BookGroup,
  type CategoryBook,
} from "@/lib/money-flow/category-book";
import { currentMonthPeriod, type PeriodFilter } from "@/lib/money-flow/period";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-primary-strong";
const primaryButton = `inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border-2 border-primary-strong bg-primary px-4 text-[13.5px] font-semibold text-on-primary shadow-card disabled:opacity-40 ${focusRing}`;
const secondaryButton = `inline-flex h-11 items-center justify-center gap-2 rounded-[4px] border-2 border-line bg-surface px-4 text-[13.5px] font-semibold text-primary ${focusRing}`;
const pane = "flex min-w-0 flex-col overflow-visible rounded-[4px] border-2 border-line bg-surface shadow-card";
const iconButton = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border-2 border-line bg-surface text-ink ${focusRing}`;

type Filter = "all" | "custom";
type MobileScreen = "groups" | "group";

export function CategoriesBoard() {
  const {
    allTransactions,
    archiveCategory,
    budgets,
    categoryBook,
    deleteCategory,
    learned,
    moveCategoryToGroup,
    period,
    restoreCategory,
    setCategoryBook,
  } = useMoneyFlow();
  const desktop = useDesktop();
  const [filter, setFilter] = useState<Filter>("all");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("groups");
  const [addingGroup, setAddingGroup] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [movePopover, setMovePopover] = useState(false);
  const [moveDest, setMoveDest] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);
  const [archiveMode, setArchiveMode] = useState<"refile" | "leave">("refile");
  const [archiveTarget, setArchiveTarget] = useState("");
  const [actionError, setActionError] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const txn of allTransactions) map.set(txn.categoryKey, (map.get(txn.categoryKey) ?? 0) + 1);
    return map;
  }, [allTransactions]);

  const yourGroups = useMemo(() => groupsFor(categoryBook, filter), [categoryBook, filter]);
  const fixedGroups = filter === "all" ? orderedFixedGroups(categoryBook) : [];
  const visibleGroups = [...yourGroups, ...fixedGroups];
  const activeGroup = visibleGroups.find((group) => group.id === groupId) ?? yourGroups[0] ?? fixedGroups[0] ?? null;
  const shown = activeGroup ? categoriesFor(categoryBook, activeGroup.id, filter) : [];
  const activeCategory = shown.find((category) => category.key === categoryKey) ?? shown[0] ?? null;
  const fixed = activeGroup ? isFixedGroup(activeGroup.id) : false;
  const month = planMonth(period);
  const liveCount = categoryBook.categories.filter((category) => !category.archivedAt).length;
  const archivedCount = categoryBook.categories.length - liveCount;
  const summary = categoriesSummary(categoryBook.groups.length, liveCount, archivedCount);
  const ruleCount = learned.filter((item) => item.categoryKey === activeCategory?.key).length;
  const planned = activeCategory ? plannedTotal(budgets, activeCategory.key) : null;
  const deleteCopy = activeCategory ? deleteConfirmCopy(activeCategory.label, ruleCount, planned) : "";
  const archived = activeGroup ? categoriesIn(categoryBook, activeGroup.id).filter((category) => category.archivedAt) : [];

  function openGroup(id: string) {
    setGroupId(id);
    setRenamingGroup(false);
    setAddingCategory(false);
    setRenamingCategory(false);
    const first = categoriesFor(categoryBook, id, filter)[0];
    setCategoryKey(first?.key ?? null);
    setMobileScreen("group");
  }

  function openCategory(key: string) {
    setCategoryKey(key);
    setRenamingCategory(false);
    setMoveOpen(false);
    setMovePopover(false);
    setArchiveOpen(false);
    setDeleteOpen(false);
  }

  function submitGroup(name: string) {
    const before = new Set(categoryBook.groups.map((group) => group.id));
    const next = addGroup(categoryBook, name);
    const created = next.groups.find((group) => !before.has(group.id));
    if (!created) return;
    setCategoryBook(next);
    setGroupId(created.id);
    setCategoryKey(null);
    setAddingGroup(false);
    setMobileScreen("group");
  }

  function submitCategory(name: string) {
    if (!activeGroup || isFixedGroup(activeGroup.id)) return;
    const before = new Set(categoryBook.categories.map((category) => category.key));
    const next = addCategory(categoryBook, activeGroup.id, name);
    const created = next.categories.find((category) => !before.has(category.key));
    if (!created) return;
    setCategoryBook(next);
    setCategoryKey(created.key);
    setAddingCategory(false);
    setMobileScreen("group");
  }

  function saveGroupName(name: string) {
    if (!activeGroup) return;
    setCategoryBook(renameGroup(categoryBook, activeGroup.id, name));
    setRenamingGroup(false);
  }

  function saveCategoryName(name: string) {
    if (!activeCategory) return;
    setCategoryBook(renameCategory(categoryBook, activeCategory.key, name));
    setRenamingCategory(false);
  }

  function openMove() {
    setActionError("");
    setMoveDest(null);
    setMovePopover(true);
    setMoveOpen(false);
    setArchiveOpen(false);
    setDeleteOpen(false);
  }

  function closeMove() {
    setMovePopover(false);
  }

  function pickMoveGroup(groupId: string) {
    setMovePopover(false);
    setMoveDest(groupId);
    setActionError("");
    setMoveOpen(true);
  }

  function openDelete() {
    setActionError("");
    setDeleteOpen(true);
    setMovePopover(false);
    setArchiveOpen(false);
  }

  function openGroupDelete() {
    if (!activeGroup || categoriesIn(categoryBook, activeGroup.id).length > 0) return;
    setActionError("");
    setGroupDeleteOpen(true);
  }

  function confirmDeleteGroup() {
    if (!activeGroup) return;
    const next = removeGroup(categoryBook, activeGroup.id);
    if (next === categoryBook) return;
    setCategoryBook(next);
    const fallback = next.groups.find((group) => !isFixedGroup(group.id)) ?? next.groups[0];
    setGroupId(fallback?.id ?? null);
    setCategoryKey(null);
    setGroupDeleteOpen(false);
  }

  function restore(key: string) {
    const result = restoreCategory(key);
    if (!result.ok) {
      setActionError(result.reason);
      return;
    }
    setActionError("");
    setCategoryKey(key);
  }

  function openArchive() {
    if (!activeCategory) return;
    const target = defaultArchiveTarget(categoryBook, activeCategory.key);
    setActionError("");
    setArchiveMode(target ? "refile" : "leave");
    setArchiveTarget(target ?? "");
    setArchiveOpen(true);
    setMoveOpen(false);
  }

  const shared = {
    filter,
    setFilter,
    summary,
    addingGroup,
    setAddingGroup,
    submitGroup,
    yourGroups,
    fixedGroups,
    activeGroup,
    shown,
    activeCategory,
    counts,
    fixed,
    openGroup,
    openCategory,
    addingCategory,
    setAddingCategory,
    submitCategory,
    renamingGroup,
    setRenamingGroup,
    saveGroupName,
    renamingCategory,
    setRenamingCategory,
    saveCategoryName,
    openMove,
    closeMove,
    pickMove: pickMoveGroup,
    openArchive,
    openDelete,
    archiveOpen,
    movePopover,
    deleteOpen,
    categoryBook,
    archived,
    restore,
    openGroupDelete,
    actionError,
  };

  return (
    <div className="font-sans text-ink">
      {desktop ? (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[32px] !font-bold !tracking-[-0.5px]">Categories</h1>
              <p className="mt-1 text-[15px] text-muted">Name, group and tidy the labels every transaction carries.</p>
            </div>
          </header>
          <Toolbar filter={filter} setFilter={setFilter} summary={summary} />
          <DesktopPanes {...shared} />
        </>
      ) : (
        <MobileScreens {...shared} screen={mobileScreen} setScreen={setMobileScreen} />
      )}
      {moveOpen && activeCategory && activeGroup ? (
        <MoveDialog
          desktop={desktop}
          book={categoryBook}
          budgets={budgets}
          transactions={allTransactions}
          category={activeCategory}
          month={month}
          ruleCount={ruleCount}
          dest={moveDest}
          error={actionError}
          onClose={() => setMoveOpen(false)}
          onConfirm={() => {
            if (!moveDest) return;
            const result = moveCategoryToGroup(activeCategory.key, moveDest);
            if (!result.ok) {
              setActionError(result.reason);
              return;
            }
            setGroupId(moveDest);
            setMoveOpen(false);
          }}
        />
      ) : null}
      {archiveOpen && activeCategory ? (
        <ArchiveDialog
          desktop={desktop}
          book={categoryBook}
          category={activeCategory}
          count={counts.get(activeCategory.key) ?? 0}
          mode={archiveMode}
          target={archiveTarget}
          error={actionError}
          onMode={setArchiveMode}
          onTarget={setArchiveTarget}
          onClose={() => setArchiveOpen(false)}
          onConfirm={() => {
            const choice =
              archiveMode === "refile"
                ? { mode: "refile" as const, targetKey: archiveTarget }
                : { mode: "leave" as const };
            const result = archiveCategory(activeCategory.key, choice);
            if (!result.ok) {
              setActionError(result.reason);
              return;
            }
            setArchiveOpen(false);
          }}
        />
      ) : null}
      {deleteOpen && activeCategory ? (
        <DeleteDialog
          desktop={desktop}
          title={deleteCopy}
          confirmLabel="Delete"
          cancelLabel="Keep category"
          error={actionError}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            const result = deleteCategory(activeCategory.key);
            if (!result.ok) {
              setActionError(result.reason);
              return;
            }
            setDeleteOpen(false);
            setCategoryKey(null);
          }}
        />
      ) : null}
      {groupDeleteOpen && activeGroup ? (
        <DeleteDialog
          desktop={desktop}
          title={`Delete ${activeGroup.label}?`}
          confirmLabel="Delete"
          cancelLabel="Keep group"
          error={actionError}
          onClose={() => setGroupDeleteOpen(false)}
          onConfirm={confirmDeleteGroup}
        />
      ) : null}
    </div>
  );
}

type BoardShared = {
  filter: Filter;
  setFilter: (filter: Filter) => void;
  summary: string;
  addingGroup: boolean;
  setAddingGroup: (open: boolean) => void;
  submitGroup: (name: string) => void;
  yourGroups: BookGroup[];
  fixedGroups: BookGroup[];
  activeGroup: BookGroup | null;
  shown: BookCategory[];
  activeCategory: BookCategory | null;
  counts: Map<string, number>;
  fixed: boolean;
  openGroup: (id: string) => void;
  openCategory: (key: string) => void;
  addingCategory: boolean;
  setAddingCategory: (open: boolean) => void;
  submitCategory: (name: string) => void;
  renamingGroup: boolean;
  setRenamingGroup: (open: boolean) => void;
  saveGroupName: (name: string) => void;
  renamingCategory: boolean;
  setRenamingCategory: (open: boolean) => void;
  saveCategoryName: (name: string) => void;
  openMove: () => void;
  closeMove: () => void;
  pickMove: (groupId: string) => void;
  openArchive: () => void;
  openDelete: () => void;
  archiveOpen: boolean;
  movePopover: boolean;
  deleteOpen: boolean;
  categoryBook: CategoryBook;
  archived: BookCategory[];
  restore: (key: string) => void;
  openGroupDelete: () => void;
  actionError: string;
};

function Toolbar({ filter, setFilter, summary }: { filter: Filter; setFilter: (filter: Filter) => void; summary: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <div className="inline-flex h-11 rounded-[4px] border-2 border-line bg-surface p-0.5" role="group" aria-label="Which categories">
        {(["all", "custom"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`inline-flex h-full items-center rounded-[4px] px-3 text-[13px] font-semibold ${
              filter === value ? "bg-primary text-on-primary" : "text-muted"
            } ${focusRing}`}
          >
            {value === "all" ? "All" : "Custom"}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-muted md:ml-auto">{summary}</p>
    </div>
  );
}

function DesktopPanes(props: BoardShared) {
  return (
    <div className="mt-4 flex items-start gap-4 overflow-x-auto pb-2">
      <GroupsPane {...props} className="w-[208px] shrink-0" />
      <ListPane {...props} className="min-w-0 flex-1" />
    </div>
  );
}

function MobileScreens(props: BoardShared & { screen: MobileScreen; setScreen: (screen: MobileScreen) => void }) {
  if (props.screen === "group" && props.activeGroup) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton label="Groups" onClick={() => props.setScreen("groups")} />
        <ListPane {...props} compact />
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-[28px] !font-bold !tracking-[-0.5px]">Categories</h1>
      <Toolbar filter={props.filter} setFilter={props.setFilter} summary={props.summary} />
      <div className="mt-4">
        <GroupsPane {...props} stacked />
      </div>
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-11 items-center gap-1 text-[15px] font-semibold text-primary ${focusRing}`}>
      <Icon name="chevron-left" />
      {label}
    </button>
  );
}

function GroupsPane({
  yourGroups,
  fixedGroups,
  activeGroup,
  categoryBook,
  filter,
  openGroup,
  addingGroup,
  setAddingGroup,
  submitGroup,
  className = "",
  stacked = false,
}: BoardShared & { className?: string; stacked?: boolean }) {
  return (
    <section className={stacked ? "flex flex-col gap-4" : `${pane} ${className}`} aria-label="Groups">
      <div className={stacked ? "" : "border-b-2 border-line p-3"}>
        {addingGroup ? (
          <NameField
            label="Group name"
            placeholder="Group name"
            submitLabel="Add"
            onSubmit={submitGroup}
            onCancel={() => setAddingGroup(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            className={`flex h-11 w-full items-center rounded-[4px] px-2 text-left text-[15px] font-semibold text-primary ${focusRing}`}
          >
            + Add group
          </button>
        )}
      </div>
      <GroupBlock
        title={stacked ? `Your groups · ${yourGroups.length}` : "Your groups"}
        groups={yourGroups}
        activeId={activeGroup?.id ?? ""}
        categoryBook={categoryBook}
        filter={filter}
        onOpen={openGroup}
        stacked={stacked}
      />
      {fixedGroups.length > 0 ? (
        <GroupBlock
          title={stacked ? "Fixed groups · Can’t be deleted" : "Fixed groups"}
          groups={fixedGroups}
          activeId={activeGroup?.id ?? ""}
          categoryBook={categoryBook}
          filter={filter}
          onOpen={openGroup}
          locked
          divided={!stacked}
          stacked={stacked}
        />
      ) : null}
    </section>
  );
}

function GroupBlock({
  title,
  groups,
  activeId,
  categoryBook,
  filter,
  onOpen,
  locked = false,
  divided = false,
  stacked = false,
}: {
  title: string;
  groups: BookGroup[];
  activeId: string;
  categoryBook: CategoryBook;
  filter: Filter;
  onOpen: (id: string) => void;
  locked?: boolean;
  divided?: boolean;
  stacked?: boolean;
}) {
  const heading = (
    <div className={`flex items-center justify-between ${stacked ? "px-0.5" : "px-3"} min-h-11`}>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.275px] text-muted">
        {title}
      </p>
    </div>
  );
  const rows = (
    <ul className={stacked ? pane : undefined}>
      {groups.map((group) => {
        const count = categoriesFor(categoryBook, group.id, filter).length;
        const selected = group.id === activeId;
        return (
          <li key={group.id} className={stacked ? "border-t-2 border-line first:border-t-0" : undefined}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onOpen(group.id)}
              className={`flex w-full items-center gap-2 px-3 text-left ${stacked ? "h-14" : "h-11 rounded-[4px]"} ${
                selected && !stacked ? "border-2 border-primary bg-accent-surface" : stacked ? "" : "border-2 border-transparent"
              } ${focusRing}`}
            >
              <span className={`min-w-0 flex-1 truncate font-semibold text-ink ${stacked ? "text-[15px]" : "text-[14px]"}`} title={group.label}>
                {group.label}
              </span>
              {locked ? (
                <span className="text-primary-strong" aria-label="Fixed group">
                  <Icon name="lock" size={13} />
                </span>
              ) : null}
              <span className={`shrink-0 text-muted ${stacked ? "text-[13px]" : "text-[12.5px]"}`}>{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const empty = groups.length === 0 ? <p className="px-3 pb-4 text-[14px] text-muted">No categories you&apos;ve added yet.</p> : null;
  if (stacked) {
    return (
      <div className="flex flex-col gap-2">
        {heading}
        {empty}
        {groups.length > 0 ? rows : null}
      </div>
    );
  }
  const body = (
    <>
      {heading}
      {empty}
      {rows}
    </>
  );
  if (!divided) return body;
  return <div className="border-t-2 border-line">{body}</div>;
}

function ListPane(props: BoardShared & { className?: string; compact?: boolean }) {
  const { activeGroup, shown, counts, fixed, className = "", compact = false } = props;
  if (!activeGroup) {
    return (
      <section className={`${pane} ${className} p-4`}>
        <p className="text-[14px] text-muted">Add a group to file categories in.</p>
      </section>
    );
  }
  const noun = shown.length === 1 ? "category" : "categories";
  const header = (
    <header className={compact ? "flex items-start justify-between gap-2" : "flex min-h-[60px] items-center gap-2 px-4 py-2"}>
      <div className="min-w-0 flex-1">
        {props.renamingGroup ? (
          <InlineName
            value={activeGroup.label}
            label={`Group name, ${activeGroup.label}`}
            className={`h-11 w-full rounded-[4px] border-2 border-primary px-2 font-bold text-ink outline-none ${compact ? "text-[28px]" : "text-[18px]"}`}
            onSave={props.saveGroupName}
            onCancel={() => props.setRenamingGroup(false)}
          />
        ) : (
          <h2 className={`truncate font-bold text-ink ${compact ? "text-[28px] tracking-[-0.5px]" : "text-[18px]"}`} title={activeGroup.label}>
            {activeGroup.label}
          </h2>
        )}
        <p className="text-[13px] text-muted">
          {shown.length} {noun}
        </p>
      </div>
      <GroupActions
        fixed={fixed}
        userMade={!isKnownGroup(activeGroup.id)}
        empty={categoriesIn(props.categoryBook, activeGroup.id).length === 0}
        onRename={() => props.setRenamingGroup(true)}
        onDelete={props.openGroupDelete}
      />
    </header>
  );
  const list = (
    <>
      {shown.length === 0 ? <p className="border-t-2 border-line px-4 py-4 text-[14px] text-muted">No categories in this group yet.</p> : null}
      <ul>
        {shown.map((category) => (
          <CategoryRow key={category.key} category={category} count={counts.get(category.key) ?? 0} compact={compact} {...props} />
        ))}
      </ul>
      {props.archived.length > 0 ? (
        <div data-archived className="border-t-2 border-line">
          <h3 className="px-4 pt-3 text-[13px] font-semibold text-ink">Archived ({formatCount(props.archived.length)})</h3>
          <ul>
            {props.archived.map((category) => (
              <li key={category.key} className="flex h-14 items-center gap-2 pl-4 pr-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink" title={category.label}>
                  {category.label}
                </span>
                <button
                  type="button"
                  aria-label={`Restore ${category.label}`}
                  onClick={() => props.restore(category.key)}
                  className={`inline-flex h-11 items-center px-3 text-[15px] font-semibold text-primary ${focusRing}`}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.actionError && !props.archiveOpen && !props.deleteOpen ? (
        <p className="border-t-2 border-line px-4 py-3 text-[13px] text-ink">{props.actionError}</p>
      ) : null}
      {fixed ? null : props.addingCategory ? (
        <div className="border-t-2 border-line p-3">
          <NameField
            label="Category name"
            placeholder="Category name"
            submitLabel="Add"
            onSubmit={props.submitCategory}
            onCancel={() => props.setAddingCategory(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => props.setAddingCategory(true)}
          className={`flex h-12 w-full items-center border-t-2 border-line px-4 text-left text-[15px] font-semibold text-primary ${focusRing}`}
        >
          + Add category
        </button>
      )}
    </>
  );
  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <section className={pane} aria-label={`${activeGroup.label} categories`}>
          {list}
        </section>
      </div>
    );
  }
  return (
    <section className={`${pane} ${className}`} aria-label={`${activeGroup.label} categories`}>
      {header}
      {list}
    </section>
  );
}

function GroupActions({
  fixed,
  userMade,
  empty,
  onRename,
  onDelete,
}: {
  fixed: boolean;
  userMade: boolean;
  empty: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  if (fixed) {
    return (
      <span className="inline-flex h-11 w-11 items-center justify-center text-primary-strong" aria-label="Fixed group" title="Fixed group">
        <Icon name="lock" />
      </span>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" aria-label="Rename group" title="Rename group" onClick={onRename} className={iconButton}>
        <Icon name="pencil" />
      </button>
      {userMade ? (
        <button
          type="button"
          aria-label="Delete group"
          aria-disabled={!empty}
          title={empty ? "Delete group" : "Move or archive its categories first"}
          onClick={() => {
            if (empty) onDelete();
          }}
          className={`${iconButton} ${empty ? "" : "text-muted opacity-40"}`}
        >
          <Icon name="bin" />
        </button>
      ) : null}
    </div>
  );
}

function CategoryRow({
  category,
  count,
  compact,
  activeCategory,
  fixed,
  renamingCategory,
  setRenamingCategory,
  saveCategoryName,
  openCategory,
  openMove,
  openArchive,
  openDelete,
  archiveOpen,
  deleteOpen,
  movePopover,
  categoryBook,
  pickMove,
  closeMove,
}: BoardShared & { category: BookCategory; count: number; compact: boolean }) {
  const selected = category.key === activeCategory?.key;
  const userMade = !category.builtin;
  return (
    <li className={`relative ${selected ? "border-2 border-primary bg-accent-surface pr-2" : "border-t-2 border-line"}`}>
      <div className={`flex min-h-14 flex-nowrap items-center gap-2 pl-4 ${selected ? "" : "pr-4"}`}>
        {selected && renamingCategory ? (
          <InlineName
            value={category.label}
            label={`Category name, ${category.label}`}
            className="h-11 min-w-0 flex-1 rounded-[4px] border-2 border-primary bg-surface px-2 text-[15px] font-semibold text-ink outline-none"
            onSave={saveCategoryName}
            onCancel={() => setRenamingCategory(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => openCategory(category.key)}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left ${focusRing}`}
          >
            <span className="truncate text-[15px] font-semibold text-ink" title={category.label}>
              {category.label}
            </span>
            {userMade ? <YoursTag /> : null}
          </button>
        )}
        <span className="shrink-0 text-[12.5px] text-muted">{transactionCountLabel(count, compact)}</span>
        {fixed ? (
          <span className="inline-flex h-11 w-11 items-center justify-center text-primary-strong" aria-label="Locked category">
            <Icon name="lock" />
          </span>
        ) : selected ? (
          <span className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label="Rename category" title="Rename category" onClick={() => setRenamingCategory(true)} className={iconButton}>
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              aria-label="Move to group"
              title="Move to group"
              aria-haspopup="listbox"
              aria-expanded={movePopover}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={movePopover ? closeMove : openMove}
              className={iconButton}
            >
              <Icon name="folder" />
            </button>
            {userMade && count === 0 ? (
              <button type="button" aria-label="Delete category" title="Delete category" aria-haspopup="dialog" aria-expanded={deleteOpen} onClick={openDelete} className={iconButton}>
                <Icon name="bin" />
              </button>
            ) : null}
            {userMade && count > 0 ? (
              <button
                type="button"
                aria-label="Archive category"
                title="Archive category"
                aria-haspopup="dialog"
                aria-expanded={archiveOpen}
                onClick={openArchive}
                className={`${iconButton} ${archiveOpen ? "border-primary bg-accent-surface" : ""}`}
              >
                <Icon name="archive" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {selected && movePopover ? (
        <MovePopover book={categoryBook} category={category} onPick={pickMove} onClose={closeMove} />
      ) : null}
    </li>
  );
}

function YoursTag() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] border-2 border-line px-[5px] text-[11px] font-semibold text-muted">
      Yours
    </span>
  );
}

function MovePopover({
  book,
  category,
  onPick,
  onClose,
}: {
  book: CategoryBook;
  category: BookCategory;
  onPick: (groupId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Move to group"
      className="absolute bottom-full right-2 z-30 mb-1 flex max-h-64 w-[220px] flex-col overflow-y-auto rounded-[4px] border-2 border-line bg-surface p-2 shadow-card"
    >
      <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.275px] text-muted">Move to group</p>
      <ul>
        {orderedYourGroups(book).map((group) => {
          const current = group.id === category.groupId;
          return (
            <li key={group.id}>
              <button
                type="button"
                role="option"
                aria-selected={current}
                disabled={current}
                onClick={() => onPick(group.id)}
                className={`flex h-11 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[15px] font-semibold ${
                  current ? "text-primary" : "text-ink"
                } ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                {current ? <Icon name="check" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MoveDialog({
  desktop,
  book,
  budgets,
  transactions,
  category,
  month,
  ruleCount,
  dest,
  error,
  onClose,
  onConfirm,
}: {
  desktop: boolean;
  book: CategoryBook;
  budgets: ReturnType<typeof useMoneyFlow>["budgets"];
  transactions: readonly { categoryKey: string }[];
  category: BookCategory;
  month: string;
  ruleCount: number;
  dest: string | null;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useDialog(onClose);
  const preview =
    dest == null
      ? null
      : previewCategoryMove({
          book,
          budgets,
          transactions,
          categoryKey: category.key,
          groupId: dest,
          month,
          ruleCount,
        });
  const copy = preview && preview.ok ? moveConfirmCopy(preview.preview, desktop ? "desktop" : "mobile") : null;
  const reason = error || (preview && !preview.ok ? preview.reason : "");
  return (
    <DialogShell desktop={desktop} titleId={titleId} onClose={onClose}>
      <DialogTitle id={titleId} title={copy?.title ?? `Move '${category.label}'`} onClose={onClose} />
      {copy ? <p className="text-[15px] text-muted">{copy.body}</p> : null}
      {copy ? (
        <div className="flex flex-col gap-3">
          <InfoLine text={copy.spending} />
          <InfoLine text={copy.planned} />
        </div>
      ) : null}
      {reason ? <p className="text-[13px] text-ink">{reason}</p> : null}
      <DialogActions
        desktop={desktop}
        confirmLabel={copy?.confirm ?? "Move"}
        confirmIcon="corner"
        disabled={!copy}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </DialogShell>
  );
}

function DeleteDialog({
  desktop,
  title,
  confirmLabel,
  cancelLabel,
  error,
  onClose,
  onConfirm,
}: {
  desktop: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useDialog(onClose);
  return (
    <DialogShell desktop={desktop} titleId={titleId} onClose={onClose}>
      <DialogTitle id={titleId} title={title} onClose={onClose} />
      {error ? <p className="text-[13px] text-ink">{error}</p> : null}
      <DialogActions
        desktop={desktop}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        confirmIcon="bin"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </DialogShell>
  );
}

function ArchiveDialog({
  desktop,
  book,
  category,
  count,
  mode,
  target,
  error,
  onMode,
  onTarget,
  onClose,
  onConfirm,
}: {
  desktop: boolean;
  book: CategoryBook;
  category: BookCategory;
  count: number;
  mode: "refile" | "leave";
  target: string;
  error: string;
  onMode: (mode: "refile" | "leave") => void;
  onTarget: (key: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useDialog(onClose);
  const targets = archiveTargetCategories(book, category.key);
  const chosen = targets.find((row) => row.key === target) ?? targets[0];
  return (
    <DialogShell desktop={desktop} titleId={titleId} onClose={onClose}>
      <DialogTitle id={titleId} title={`Archive \u2018${category.label}\u2019?`} onClose={onClose} />
      <p className="text-[15px] text-muted">{archiveIntro(category.label, count, desktop ? "desktop" : "mobile")}</p>
      <div className="flex flex-col gap-3">
        <ChoiceCard
          selected={mode === "refile"}
          disabled={targets.length === 0}
          label={archiveRefileLabel(count)}
          onSelect={() => onMode("refile")}
        >
          {mode === "refile" && chosen ? (
            <>
              <TargetSelect targets={targets} value={chosen.key} onChange={onTarget} />
              <p className="mt-2 text-[13px] text-muted">{archiveRulesNote(chosen.groupLabel, chosen.label)}</p>
            </>
          ) : null}
        </ChoiceCard>
        <ChoiceCard selected={mode === "leave"} label={ARCHIVE_LEAVE_LABEL} onSelect={() => onMode("leave")}>
          <p className="mt-1 text-[13px] text-muted">{ARCHIVE_LEAVE_NOTE}</p>
        </ChoiceCard>
      </div>
      <p className="flex items-start gap-2 text-[13px] text-ink-soft">
        <span className="mt-0.5 shrink-0">
          <Icon name="archive" size={16} />
        </span>
        {ARCHIVE_PLAN_NOTE}
      </p>
      {error ? <p className="text-[13px] text-ink">{error}</p> : null}
      <DialogActions
        desktop={desktop}
        confirmLabel={mode === "refile" ? "Move and archive" : "Archive"}
        confirmIcon="archive"
        disabled={mode === "refile" && !chosen}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </DialogShell>
  );
}

function ChoiceCard({
  selected,
  disabled = false,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-[4px] border-2 p-4 ${selected ? "border-primary bg-accent-surface" : "border-line bg-surface"}`}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className={`flex w-full items-start gap-3 text-left text-[15px] font-semibold text-ink disabled:opacity-40 ${focusRing}`}
      >
        <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border-2 ${selected ? "border-primary" : "border-line"}`}>
          {selected ? <span className="h-2.5 w-2.5 rounded-[4px] bg-primary" /> : null}
        </span>
        {label}
      </button>
      {selected ? <div className="pl-8">{children}</div> : null}
    </div>
  );
}

function TargetSelect({ targets, value, onChange }: { targets: ArchiveTarget[]; value: string; onChange: (key: string) => void }) {
  return (
    <label className="mt-3 block">
      <span className="sr-only">Category that receives the transactions</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-[4px] border-2 border-primary bg-surface px-3 text-[14px] font-semibold text-ink outline-none"
      >
        {targets.map((target) => (
          <option key={target.key} value={target.key}>
            {target.groupLabel} › {target.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function InfoLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-[4px] bg-surface-subtle p-3 text-[14px] text-ink">
      <span className="mt-0.5 shrink-0 text-primary">
        <Icon name="corner" size={16} />
      </span>
      {text}
    </p>
  );
}

function DialogActions({
  desktop,
  confirmLabel,
  confirmIcon,
  cancelLabel,
  disabled = false,
  onConfirm,
  onClose,
}: {
  desktop: boolean;
  confirmLabel: string;
  confirmIcon: "corner" | "archive" | "bin";
  cancelLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirm = (
    <button type="button" className={desktop ? primaryButton : `${primaryButton} h-12 w-full`} disabled={disabled} onClick={onConfirm}>
      <Icon name={confirmIcon} size={16} /> {confirmLabel}
    </button>
  );
  const cancel = (
    <button type="button" className={desktop ? secondaryButton : `${secondaryButton} h-12 w-full`} onClick={onClose}>
      {cancelLabel ?? (confirmLabel.startsWith("Move to") ? "Cancel" : "Keep category")}
    </button>
  );
  return <div className={desktop ? "mt-2 flex justify-end gap-4" : "flex flex-col gap-3"}>{desktop ? <>{cancel}{confirm}</> : <>{confirm}{cancel}</>}</div>;
}

function DialogShell({
  desktop,
  titleId,
  onClose,
  children,
}: {
  desktop: boolean;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-ink/45" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          desktop
            ? "fixed left-1/2 top-1/2 z-50 flex w-[520px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[4px] border-2 border-line bg-surface p-6 shadow-card"
            : "fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col gap-3.5 overflow-y-auto rounded-t-[4px] border-t-2 border-line bg-surface px-5 pb-8 pt-2.5 shadow-card"
        }
      >
        {desktop ? null : <div className="mx-auto h-1 w-10 rounded-[4px] bg-line" aria-hidden />}
        {children}
      </div>
    </>,
    document.body,
  );
}

function DialogTitle({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 id={id} className="text-[20px] font-bold text-ink">
        {title}
      </h2>
      <button type="button" aria-label="Close" title="Close" onClick={onClose} className={`inline-flex h-11 w-11 items-center justify-center text-ink ${focusRing}`}>
        <Icon name="x" />
      </button>
    </div>
  );
}

function NameField({
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim();
        if (!next) return;
        onSubmit(next);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="h-11 min-w-0 flex-1 rounded-[4px] border-2 border-primary bg-surface px-3 text-[15px] text-ink outline-none"
      />
      <button type="submit" className={primaryButton}>
        {submitLabel}
      </button>
      <button type="button" aria-label="Cancel" title="Cancel" onClick={onCancel} className={`inline-flex h-11 w-11 items-center justify-center text-ink ${focusRing}`}>
        <Icon name="x" />
      </button>
    </form>
  );
}

function InlineName({
  value,
  label,
  className,
  onSave,
  onCancel,
}: {
  value: string;
  label: string;
  className: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const skippedRef = useRef(false);
  return (
    <input
      value={draft}
      aria-label={label}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (skippedRef.current) return;
        onSave(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSave(draft);
        }
        if (event.key === "Escape") {
          skippedRef.current = true;
          onCancel();
        }
      }}
      className={className}
    />
  );
}

function useDialog(onClose: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function groupsFor(book: CategoryBook, filter: Filter): BookGroup[] {
  return orderedYourGroups(book).filter((group) => {
    if (filter === "all") return true;
    const custom = categoriesIn(book, group.id).filter((category) => !category.builtin);
    return custom.length > 0 || !isKnownGroup(group.id);
  });
}

function categoriesFor(book: CategoryBook, groupId: string, filter: Filter): BookCategory[] {
  return categoriesIn(book, groupId).filter((category) => !category.archivedAt && (filter === "all" || !category.builtin));
}

function planMonth(period: PeriodFilter): string {
  if (period.kind === "month") return period.month;
  const opened = currentMonthPeriod();
  if (opened.kind === "month") return opened.month;
  return "";
}

function useDesktop() {
  return useSyncExternalStore(subscribeDesktop, desktopNow, () => true);
}

function subscribeDesktop(onStoreChange: () => void) {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function desktopNow() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function Icon({ name, size = 18 }: { name: "plus" | "pencil" | "archive" | "lock" | "chevron-right" | "chevron-left" | "x" | "check" | "corner" | "folder" | "bin"; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "pencil") {
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "archive") {
    return (
      <svg {...common}>
        <path d="M21 8v13H3V8" />
        <path d="M1 3h22v5H1z" />
        <path d="M10 12h4" />
      </svg>
    );
  }
  if (name === "folder") {
    return (
      <svg {...common}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    );
  }
  if (name === "bin") {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 12h8l1-12" />
      </svg>
    );
  }
  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="5" y="11" width="14" height="10" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    );
  }
  if (name === "chevron-right") {
    return (
      <svg {...common}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    );
  }
  if (name === "chevron-left") {
    return (
      <svg {...common}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    );
  }
  if (name === "x") {
    return (
      <svg {...common}>
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M15 14l5-5-5-5" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}
