import { Card, TextHit } from "@/components/card";
import { formatAud } from "@/lib/format";
import type { BankAccountLine, BankInstitutionTile } from "@/lib/money-flow/dashboard";

export function BankAccountsCard({ tiles }: { tiles: BankInstitutionTile[] }) {
  const accounts = tiles.flatMap((tile) =>
    tile.accounts.map((account) => ({ ...account, institution: tile.institution })),
  );

  if (accounts.length === 0) {
    return (
      <Card title="Bank accounts">
        <p className="text-[14px] text-muted">No accounts to show yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Bank accounts" action={<TextHit href="/accounts">Manage</TextHit>}>
      <ul className="grid w-full max-w-[708px] grid-cols-2 gap-3 sm:grid-cols-4">
        {accounts.map((account) => (
          <li key={account.id}>
            <AccountTile account={account} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountTile({
  account,
}: {
  account: BankAccountLine & { institution: string };
}) {
  return (
    <div className="rounded-[12px] bg-surface-subtle px-3 py-3">
      <p className="truncate text-[13px] text-muted">
        {account.institution} · {account.name}
      </p>
      {account.amount == null ? (
        <p className="mt-1 text-[14px] font-semibold text-ink">{account.balanceLabel ?? "—"}</p>
      ) : (
        <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-ink">{formatAud(account.amount)}</p>
      )}
      {account.amount != null && account.balanceLabel ? (
        <p className="mt-1 text-[12px] text-muted">{account.balanceLabel}</p>
      ) : null}
      {account.balancePrompt ? <p className="mt-1 text-[12px] text-muted">{account.balancePrompt}</p> : null}
      {account.balanceWarning ? <p className="mt-1 text-[12px] text-ink">{account.balanceWarning}</p> : null}
    </div>
  );
}
