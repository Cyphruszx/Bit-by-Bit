"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMoneyFlow } from "@/components/money-flow-provider";
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
  fixedGroupsLine,
  moveConfirmCopy,
  moveGroupChoices,
  orderedFixedGroups,
  orderedYourGroups,
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
const pane = "flex min-w-0 flex-col rounded-[4px] border-2 border-line bg-surface shadow-card";
const MOVE_HINT = "Moving re-files past transactions and carries its plan with it.";

type Filter = "all" | "custom";
type MobileScreen = "groups" | "group" | "category";

export function CategoriesBoard() {
  const {
    allTransactions,
    archiveCategory,
    budgets,
    categoryBook,
    learned,
    moveCategoryToGroup,
    period,
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
  const [moveDest, setMoveDest] = useState<string | null>(null);
  const [moveStep, setMoveStep] = useState<"pick" | "confirm">("pick");
  const [archiveOpen, setArchiveOpen] = useState(false);
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
    setArchiveOpen(false);
    setMobileScreen("category");
  }

  function startAddCategory() {
    const target = activeGroup && !isFixedGroup(activeGroup.id) ? activeGroup : yourGroups[0];
    if (!target) {
      setAddingGroup(true);
      return;
    }
    setGroupId(target.id);
    setAddingCategory(true);
    setMobileScreen("group");
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
    setMobileScreen("category");
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
    setMoveStep("pick");
    setMoveOpen(true);
    setArchiveOpen(false);
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
    startAddCategory,
    openMove,
    openArchive,
    archiveOpen,
    categoryBook,
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
            <div className="flex flex-wrap gap-4">
              <button type="button" className={secondaryButton} onClick={startAddCategory}>
                <Icon name="plus" size={16} /> Add category
              </button>
              <button type="button" className={primaryButton} onClick={() => setAddingGroup(true)}>
                <Icon name="plus" size={16} /> Add group
              </button>
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
          step={moveStep}
          error={actionError}
          onDest={setMoveDest}
          onStep={setMoveStep}
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
            setMobileScreen("group");
          }}
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
  startAddCategory: () => void;
  openMove: () => void;
  openArchive: () => void;
  archiveOpen: boolean;
  categoryBook: CategoryBook;
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
      <ListPane {...props} className="min-w-[448px] flex-1" />
      <DetailPane {...props} hint className="w-[304px] shrink-0" />
    </div>
  );
}

function MobileScreens(props: BoardShared & { screen: MobileScreen; setScreen: (screen: MobileScreen) => void }) {
  if (props.screen === "category" && props.activeCategory && props.activeGroup) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton label={props.activeGroup.label} onClick={() => props.setScreen("group")} />
        <DetailPane {...props} hint={false} framed={false} />
      </div>
    );
  }
  if (props.screen === "group" && props.activeGroup) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton label="Categories" onClick={() => props.setScreen("groups")} />
        <ListPane {...props} compact />
        <p className="text-[13px] text-muted">Tap a category to open it.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[28px] !font-bold !tracking-[-0.5px]">Categories</h1>
        <button type="button" className={secondaryButton} onClick={() => props.setAddingGroup(true)}>
          <Icon name="plus" size={16} /> Group
        </button>
      </div>
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
  counts,
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
      <GroupBlock
        title={stacked ? `Your groups · ${yourGroups.length}` : "Your groups"}
        groups={yourGroups}
        activeId={activeGroup?.id ?? ""}
        categoryBook={categoryBook}
        filter={filter}
        onOpen={openGroup}
        adding={addingGroup}
        onStartAdd={() => setAddingGroup(true)}
        onSubmit={submitGroup}
        onCancel={() => setAddingGroup(false)}
        showPlus={!stacked}
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
  showPlus = false,
  adding = false,
  onStartAdd,
  onSubmit,
  onCancel,
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
  showPlus?: boolean;
  adding?: boolean;
  onStartAdd?: () => void;
  onSubmit?: (name: string) => void;
  onCancel?: () => void;
  stacked?: boolean;
}) {
  const heading = (
    <div className={`flex items-center justify-between ${stacked ? "px-0.5" : "px-3"} ${locked && !stacked ? "h-8" : "min-h-11"}`}>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.275px] text-muted">
        {locked ? (
          <span className="text-primary-strong">
            <Icon name="lock" size={13} />
          </span>
        ) : null}
        {title}
      </p>
      {showPlus ? (
        <button
          type="button"
          aria-label="Add group"
          title="Add group"
          onClick={onStartAdd}
          className={`inline-flex h-11 w-11 items-center justify-center text-primary ${focusRing}`}
        >
          <Icon name="plus" />
        </button>
      ) : null}
    </div>
  );
  const form =
    adding && onSubmit && onCancel ? (
      <div className={stacked ? "pb-1" : "px-3 pb-3"}>
        <NameField label="Group name" placeholder="Group name" submitLabel="Add" onSubmit={onSubmit} onCancel={onCancel} />
      </div>
    ) : null;
  const rows = (
    <ul className={stacked ? pane : undefined}>
      {groups.map((group) => {
        const count = categoriesFor(categoryBook, group.id, filter).length;
        const selected = group.id === activeId;
        const label = stacked ? `${count} ${count === 1 ? "category" : "categories"}` : String(count);
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
              {locked && !stacked ? (
                <span className="text-primary-strong">
                  <Icon name="lock" size={13} />
                </span>
              ) : null}
              <span className={`shrink-0 text-muted ${stacked ? "text-[13px]" : "text-[12.5px]"}`}>{label}</span>
              {stacked ? <Icon name="chevron-right" /> : null}
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
        {form}
        {empty}
        {groups.length > 0 ? rows : null}
      </div>
    );
  }
  const body = (
    <>
      {heading}
      {form}
      {empty}
      {rows}
    </>
  );
  if (!divided) return body;
  return <div className="border-t-2 border-line">{body}</div>;
}

function ListPane(props: BoardShared & { className?: string; compact?: boolean }) {
  const { activeGroup, shown, activeCategory, counts, fixed, className = "", compact = false } = props;
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
      {fixed ? null : (
        <button
          type="button"
          aria-label="Rename group"
          title="Rename group"
          onClick={() => props.setRenamingGroup(true)}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-line text-primary ${focusRing}`}
        >
          <Icon name="pencil" />
        </button>
      )}
    </header>
  );
  const list = (
    <>
      {shown.length === 0 ? <p className="border-t-2 border-line px-4 py-4 text-[14px] text-muted">No categories in this group yet.</p> : null}
      <ul>
        {shown.map((category) => {
          const count = counts.get(category.key) ?? 0;
          const selected = category.key === activeCategory?.key;
          return (
            <li key={category.key} className={compact ? "border-t-2 border-line first:border-t-0" : undefined}>
              <button
                type="button"
                onClick={() => props.openCategory(category.key)}
                className={`flex h-14 w-full items-center gap-3 px-4 text-left ${compact ? "" : "border-t-2 border-line"} ${
                  !compact && selected ? "bg-accent-surface" : "bg-surface"
                } ${focusRing}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink" title={category.label}>
                    {category.label}
                  </span>
                  {category.builtin ? null : <YoursTag />}
                </span>
                <span className="shrink-0 text-[12.5px] text-muted">{transactionCountLabel(count, compact)}</span>
                {compact ? <Icon name="chevron-right" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
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

function DetailPane({
  activeCategory,
  activeGroup,
  counts,
  fixed,
  hint,
  renamingCategory,
  setRenamingCategory,
  saveCategoryName,
  openMove,
  openArchive,
  archiveOpen,
  className = "",
  framed = true,
}: BoardShared & { hint: boolean; className?: string; framed?: boolean }) {
  if (!activeCategory || !activeGroup) {
    return (
      <section className={`${pane} ${className} p-4`} aria-label="Category">
        <p className="text-[14px] text-muted">Choose a category.</p>
      </section>
    );
  }
  const count = counts.get(activeCategory.key) ?? 0;
  const heading = (
    <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {renamingCategory ? (
            <InlineName
              value={activeCategory.label}
              label={`Category name, ${activeCategory.label}`}
              className="h-11 min-w-0 flex-1 rounded-[4px] border-2 border-primary px-2 text-[20px] font-bold text-ink outline-none"
              onSave={saveCategoryName}
              onCancel={() => setRenamingCategory(false)}
            />
          ) : (
            <h2 className={`truncate font-bold text-ink ${framed ? "text-[20px]" : "text-[28px] tracking-[-0.5px]"}`} title={activeCategory.label}>
              {activeCategory.label}
            </h2>
          )}
          {activeCategory.builtin ? null : <YoursTag />}
        </div>
        {fixed ? null : (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              aria-label="Rename category"
              title="Rename category"
              onClick={() => setRenamingCategory(true)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-line bg-surface text-ink ${focusRing}`}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              aria-label="Archive category"
              title="Archive category"
              aria-haspopup="dialog"
              aria-expanded={archiveOpen}
              onClick={openArchive}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-[4px] border-2 text-ink ${
                archiveOpen ? "border-primary bg-accent-surface" : "border-line bg-surface"
              } ${focusRing}`}
            >
              <Icon name="archive" />
            </button>
          </div>
        )}
      </div>
  );
  const group = (
    <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.275px] text-muted">Group</h3>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-[4px] border-2 border-line px-3">
          <span className="min-w-0 truncate text-[14px] font-semibold text-ink" title={activeGroup.label}>
            {activeGroup.label}
          </span>
          {fixed ? (
            <span className="text-primary-strong">
              <Icon name="lock" size={13} />
            </span>
          ) : (
            <button type="button" onClick={openMove} className={`inline-flex h-11 shrink-0 items-center text-[13.5px] font-semibold text-primary ${focusRing}`}>
              Move to group…
            </button>
          )}
        </div>
        {fixed ? null : hint ? <p className="text-[13px] leading-5 text-muted">{MOVE_HINT}</p> : null}
      </div>
  );
  if (!framed) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <p className="text-[15px] text-muted">{transactionCountLabel(count)}</p>
        <section className={`${pane} gap-4 p-4`} aria-label={activeCategory.label}>
          {group}
        </section>
      </div>
    );
  }
  return (
    <section className={`${pane} ${className} gap-4 p-4`} aria-label={activeCategory.label}>
      {heading}
      <p className="text-[15px] text-muted">{transactionCountLabel(count)}</p>
      {group}
    </section>
  );
}

function YoursTag() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] border-2 border-line px-[5px] text-[11px] font-semibold text-muted">
      Yours
    </span>
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
  step,
  error,
  onDest,
  onStep,
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
  step: "pick" | "confirm";
  error: string;
  onDest: (id: string) => void;
  onStep: (step: "pick" | "confirm") => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useDialog(onClose);
  const choices = moveGroupChoices(book, category.key);
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
  const fixedLabels = orderedFixedGroups(book).map((group) => group.label);

  return (
    <DialogShell desktop={desktop} titleId={titleId} onClose={onClose}>
      {step === "pick" || !copy ? (
        <>
          <DialogTitle id={titleId} title={`Move \u2018${category.label}\u2019 to…`} onClose={onClose} />
          <ul className="flex flex-col">
            {choices
              .filter((choice) => desktop || choice.state !== "fixed")
              .map((choice) => {
                const selected = choice.id === dest;
                if (choice.state === "fixed") {
                  return (
                    <li key={choice.id} className="flex min-h-11 items-center gap-2 px-3 text-muted">
                      <span className="min-w-0 flex-1 truncate text-[15px]">{choice.label}</span>
                      <Icon name="lock" size={13} />
                    </li>
                  );
                }
                return (
                  <li key={choice.id}>
                    <button
                      type="button"
                      disabled={choice.state === "current"}
                      onClick={() => onDest(choice.id)}
                      className={`flex min-h-11 w-full items-center gap-2 rounded-[4px] px-3 text-left text-[15px] font-semibold ${
                        choice.state === "current"
                          ? "text-muted"
                          : selected
                            ? "border-2 border-primary bg-accent-surface text-primary"
                            : "text-ink"
                      } ${focusRing}`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {choice.label}
                        {choice.state === "current" ? " (current)" : ""}
                      </span>
                      {selected ? <Icon name="check" /> : null}
                    </button>
                  </li>
                );
              })}
          </ul>
          {desktop ? null : (
            <p className="flex items-center gap-2 border-t-2 border-line pt-3 text-[13px] text-muted">
              <Icon name="lock" size={13} />
              {fixedGroupsLine(fixedLabels)}
            </p>
          )}
          {error ? <p className="text-[13px] text-ink">{error}</p> : null}
          <div className={desktop ? "mt-4 flex justify-end gap-4" : "mt-2 flex flex-col gap-3"}>
            <button type="button" className={desktop ? primaryButton : `${primaryButton} h-12 w-full`} disabled={!dest} onClick={() => onStep("confirm")}>
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          <DialogTitle id={titleId} title={copy.title} onClose={onClose} />
          <p className="text-[15px] text-muted">{copy.body}</p>
          <div className="flex flex-col gap-3">
            <InfoLine text={copy.spending} />
            <InfoLine text={copy.planned} />
          </div>
          {error ? <p className="text-[13px] text-ink">{error}</p> : null}
          <DialogActions
            desktop={desktop}
            confirmLabel={copy.confirm}
            confirmIcon="corner"
            onConfirm={onConfirm}
            onClose={onClose}
          />
        </>
      )}
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
  disabled = false,
  onConfirm,
  onClose,
}: {
  desktop: boolean;
  confirmLabel: string;
  confirmIcon: "corner" | "archive";
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
      {confirmLabel.startsWith("Move to") ? "Cancel" : "Keep category"}
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
    const custom = categoriesIn(book, group.id).filter((category) => !category.archivedAt && !category.builtin);
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

function Icon({ name, size = 18 }: { name: "plus" | "pencil" | "archive" | "lock" | "chevron-right" | "chevron-left" | "x" | "check" | "corner"; size?: number }) {
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
