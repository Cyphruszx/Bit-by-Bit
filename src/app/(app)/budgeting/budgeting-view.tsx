"use client";

import { useMemo, useRef, useState } from "react";
import { BudgetRing } from "@/components/budget-ring";
import { EmptyLedger } from "@/components/empty-ledger";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatAud } from "@/lib/format";
import {
  budgetGroupLines,
  leftToPlan,
  leftToSpend,
  monthPlan,
  parseMoneyInput,
  planTotals,
  spentByCategoryKey,
  unsortedSpent,
  type BudgetGroupLine,
} from "@/lib/money-flow/budget-plan";
import { APP_TIME_ZONE, filterByPeriod, formatMonthLabel } from "@/lib/money-flow/period";

export function BudgetEmptyState() {
  return (
    <>
      <h1 className="text-[32px]">Budget</h1>
      <EmptyLedger>
        A budget starts once a statement is in. You’ll set an amount for each group, then see spent against it.
      </EmptyLedger>
    </>
  );
}

export function BudgetingView() {
  const {
    allTransactions,
    budgets,
    categoryBook,
    hasUploads,
    period,
    setCategoryBudget,
    setExpectedIncome,
    setGroupBudget,
  } = useMoneyFlow();
  const month = period.kind === "month" ? period.month : sydneyMonth();
  const plan = monthPlan(budgets, month);
  const spent = useMemo(
    () => spentByCategoryKey(filterByPeriod(allTransactions, { kind: "month", month })),
    [allTransactions, month],
  );
  const lines = budgetGroupLines(categoryBook, plan, spent, month);
  const loose = unsortedSpent(categoryBook, spent);
  const totals = planTotals(lines);
  const toPlan = leftToPlan(plan.income ?? null, totals.planned);
  const toSpend = leftToSpend(totals.planned, totals.spent);
  const monthName = formatMonthLabel(month);

  if (!hasUploads) return <BudgetEmptyState />;

  return (
    <>
      <h1 className="text-[32px]">Budget</h1>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="card p-5">
          <p className="text-sm text-muted">Expected income · {monthName}</p>
          <MoneyField
            value={plan.income ?? null}
            blankLabel="Not set"
            ariaLabel={`Expected income for ${monthName}`}
            prominent
            onCommit={(amount) => setExpectedIncome(month, amount)}
          />
          <p className="mt-1 text-[12.5px] text-muted">{plan.income == null ? "Not set" : "Typed by you"}</p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-muted">{toPlan.status === "over" ? "Over-planned" : "Left to plan"}</p>
          <p className="mt-2 text-[24px] font-display tabular-nums">
            {toPlan.status === "unset"
              ? "Not set"
              : toPlan.status === "over"
                ? `Over-planned by ${formatAud(toPlan.amount)}`
                : formatAud(toPlan.amount)}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {toPlan.status === "unset"
              ? "Set expected income to see what’s left to plan"
              : `${formatAud(toPlan.income)} expected minus ${formatAud(toPlan.planned)} planned`}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-muted">Left to spend</p>
          <p className="mt-2 text-[24px] font-display tabular-nums">
            {toSpend.over ? `${formatAud(toSpend.amount)} over` : formatAud(toSpend.amount)}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {formatAud(toSpend.planned)} planned minus {formatAud(toSpend.spent)} spent
          </p>
        </article>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {lines.map((line) => (
          <GroupCard
            key={line.id}
            line={line}
            onGroup={(amount) => setGroupBudget(month, line.id, amount)}
            onCategory={(key, amount) => setCategoryBudget(month, key, amount)}
          />
        ))}
      </div>

      <div className="card mt-4 w-full p-5">
        <p className="text-[15.5px] font-bold">Unsorted</p>
        <p className="text-[12.5px] text-muted">{formatAud(loose)} spent</p>
      </div>
    </>
  );
}

function GroupCard({
  line,
  onGroup,
  onCategory,
}: {
  line: BudgetGroupLine;
  onGroup: (amount: number | null) => void;
  onCategory: (key: string, amount: number | null) => void;
}) {
  return (
    <article className="card flex items-start justify-between gap-4 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15.5px] font-bold">{line.label}</h2>
            <p className="text-[12.5px] text-muted">{formatAud(line.spent)} spent</p>
          </div>
          <MoneyField
            value={line.amount}
            blankLabel={formatAud(line.categorySum)}
            ariaLabel={`${line.label} amount`}
            onCommit={onGroup}
          />
        </div>
        {line.shortfall != null ? (
          <p className="mt-2 text-[12.5px] font-semibold text-primary">
            Less than your categories ({formatAud(line.shortfall)})
          </p>
        ) : null}
        {line.categories.length > 0 ? (
          <div className="mt-4 grid gap-3 rounded-[var(--radius-inner)] border-2 border-line bg-surface-subtle p-3">
            {line.categories.map((category) => (
              <div key={category.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{category.label}</p>
                  <p className="text-[12.5px] text-muted">{formatAud(category.spent)} spent</p>
                </div>
                <MoneyField
                  value={category.amount}
                  blankLabel="Add amount"
                  ariaLabel={`${category.label} amount`}
                  onCommit={(amount) => onCategory(category.key, amount)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <BudgetRing planned={line.counted} spent={line.spent} />
    </article>
  );
}

function MoneyField({
  value,
  blankLabel,
  ariaLabel,
  onCommit,
  prominent = false,
}: {
  value: number | null;
  blankLabel: string;
  ariaLabel: string;
  onCommit: (amount: number | null) => void;
  prominent?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const skipCommit = useRef(false);
  const shown = draft ?? (value == null ? "" : formatAud(value));

  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      placeholder={blankLabel}
      value={shown}
      onFocus={() => setDraft(value == null ? "" : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (skipCommit.current) {
          skipCommit.current = false;
          setDraft(null);
          return;
        }
        if (draft == null) return;
        const parsed = parseMoneyInput(draft);
        if (parsed !== "invalid") onCommit(parsed);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          skipCommit.current = true;
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className={`rounded-[var(--radius-inner)] border-2 border-line bg-surface text-right text-ink outline-none placeholder:text-muted focus:border-primary ${
        prominent
          ? "mt-2 w-full px-3 py-1.5 font-display text-[24px] tabular-nums"
          : "w-[8.5rem] px-2 py-1 font-sans text-sm tabular-nums"
      }`}
    />
  );
}

function sydneyMonth(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }).slice(0, 7);
}
