import { formatAud } from "@/lib/format";
import { bankTileTotal, type BankInstitutionTile } from "@/lib/money-flow/dashboard";

export function BankAccountsCard({ tiles }: { tiles: BankInstitutionTile[] }) {
  if (tiles.length === 0) {
    return (
      <article className="card p-[22px]">
        <h3 className="text-[15.5px] font-bold">Bank Accounts</h3>
        <p className="mt-3 text-sm text-muted">No accounts to show yet.</p>
      </article>
    );
  }

  return (
    <article className="card flex flex-col gap-3 p-[22px]">
      <h3 className="text-[15.5px] font-bold">Bank Accounts</h3>
      <div className="grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <InstitutionTile key={tile.institution} tile={tile} />
        ))}
      </div>
    </article>
  );
}

function InstitutionTile({ tile }: { tile: BankInstitutionTile }) {
  const total = bankTileTotal(tile);
  return (
    <div className="flex min-h-[180px] flex-col gap-2 self-stretch rounded-[var(--radius-inner)] border border-line bg-surface-subtle p-4">
      <p className="text-[15px] font-bold">{tile.institution}</p>
      <div className="flex flex-col gap-2">
        {tile.accounts.map((account, index) => (
          <div
            key={account.id}
            className={`flex items-center justify-between gap-2 ${index > 0 ? "border-t border-line pt-2" : ""}`}
          >
            <p className="min-w-0 truncate text-[13px] font-medium text-muted">{account.name}</p>
            <BalanceFigure
              amount={account.amount}
              label={account.balanceLabel}
              prompt={account.balancePrompt}
              warning={account.balanceWarning}
            />
          </div>
        ))}
      </div>
      {total ? (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2">
          <p className="text-[13px] font-semibold">Total</p>
          <BalanceFigure
            amount={total.amount}
            label={total.label}
            prompt={total.excludedNote ?? (total.amount == null ? total.prompt : undefined)}
            warning={total.warning}
          />
        </div>
      ) : null}
    </div>
  );
}

function BalanceFigure({
  amount,
  label,
  prompt,
  warning,
}: {
  amount: number | null;
  label?: string;
  prompt?: string;
  warning?: string;
}) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-sm font-bold tabular-nums">{amount == null ? (label ?? "—") : formatAud(amount)}</p>
      {amount != null && label ? <p className="text-[11px] text-muted">{label}</p> : null}
      {prompt ? <p className="max-w-[14rem] text-[11px] text-muted">{prompt}</p> : null}
      {warning ? <p className="max-w-[14rem] text-[11px] text-negative">{warning}</p> : null}
    </div>
  );
}
