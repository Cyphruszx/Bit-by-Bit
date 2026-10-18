import { formatAud } from "@/lib/format";
import type { DashboardBudgetCard as DashboardBudgetCardModel, DashboardBudgetTile } from "@/lib/money-flow/budget-plan";

export function DashboardBudgetCard({ card }: { card: DashboardBudgetCardModel }) {
  return (
    <article className="card flex flex-col gap-5 px-8 py-[22px]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15.5px] font-bold">Budget</h3>
        <div className="ml-auto flex shrink-0 flex-col items-start gap-2 text-left">
          <p className="text-sm font-bold">Total</p>
          <SpentPlanned spent={card.spent} planned={card.planned} />
          <div className="flex flex-col items-start">
            <p className="text-xs leading-4 text-muted">{card.over ? "over" : "left"}</p>
            <p
              className={`text-2xl font-semibold leading-tight tabular-nums ${
                card.over ? "text-primary-strong" : "text-primary"
              }`}
            >
              {formatAud(card.remainder)}
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {card.tiles.map((tile) => (
          <GroupTile key={tile.id} tile={tile} />
        ))}
      </div>
    </article>
  );
}

function GroupTile({ tile }: { tile: DashboardBudgetTile }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] border-2 border-line bg-surface-subtle p-4">
      <p className="text-sm font-bold">{tile.label}</p>
      {tile.kind === "unsorted" || tile.planned == null || tile.remainder == null ? (
        <AmountColumn label="spent" amount={formatAud(tile.spent)} />
      ) : (
        <SpentPlanned
          spent={tile.spent}
          planned={tile.planned}
          remainder={tile.remainder}
          over={tile.over === true}
        />
      )}
    </div>
  );
}

function SpentPlanned({
  spent,
  planned,
  remainder,
  over = false,
}: {
  spent: number;
  planned: number;
  remainder?: number;
  over?: boolean;
}) {
  const showRemainder = remainder != null;
  return (
    <div
      className={`grid items-baseline ${
        showRemainder
          ? "w-full grid-cols-[auto_auto_auto_minmax(0,1fr)_auto]"
          : "w-max grid-cols-[auto_auto_auto]"
      }`}
    >
      <span className="col-start-1 row-start-1 whitespace-nowrap text-[11px] leading-[14px] text-muted">spent</span>
      <span className="col-start-3 row-start-1 whitespace-nowrap text-[11px] leading-[14px] text-muted">planned</span>
      {showRemainder ? (
        <span className="col-start-5 row-start-1 whitespace-nowrap text-[11px] leading-[14px] text-muted">
          {over ? "over" : "left"}
        </span>
      ) : null}
      <span className="col-start-1 row-start-2 whitespace-nowrap text-[13px] font-semibold leading-[18px] tabular-nums">
        {formatAud(spent)}
      </span>
      <span className="col-start-2 row-start-2 whitespace-nowrap text-[13px] font-semibold leading-[18px] text-muted">
        {" / "}
      </span>
      <span className="col-start-3 row-start-2 whitespace-nowrap text-[13px] font-semibold leading-[18px] tabular-nums">
        {formatAud(planned)}
      </span>
      {showRemainder ? (
        <span
          className={`col-start-5 row-start-2 whitespace-nowrap text-left text-[15px] font-bold leading-[18px] tabular-nums ${
            over ? "text-primary-strong" : "text-primary"
          }`}
        >
          {formatAud(remainder)}
        </span>
      ) : null}
    </div>
  );
}

function AmountColumn({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[11px] leading-[14px] text-muted">{label}</span>
      <span className="text-[13px] font-semibold leading-[18px] tabular-nums">{amount}</span>
    </div>
  );
}
