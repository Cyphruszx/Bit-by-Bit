"use client";

import { useState } from "react";
import {
  deleteGoal,
  dismissEnableOffer,
  enableFeature,
  saveGoal,
  saveLinkedAccounts,
  useShell,
} from "@/components/shell-store";
import { formatAud } from "@/lib/format";
import type { FeatureId } from "@/lib/shell/core-shell";

export function EnableOffer({ items }: { items: { id: FeatureId; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-lg font-bold">Add to this dashboard?</h2>
      <p className="mt-1 text-sm text-muted">
        Goals and Linked balances stay off until you turn them on. They are not Virtual Buckets, and
        neither writes the ledger.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => enableFeature(item.id, true)}
            className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-primary"
          >
            Enable {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={dismissEnableOffer}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

export function CustomiseShell({ firstCleared }: { firstCleared: boolean }) {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft"
      >
        Customise
      </button>
      {open ? (
        <section className="mt-3 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold">Customise</h2>
          <p className="mt-1 text-sm text-muted">
            Theme: {shell.theme}. Turning a widget off hides it and archives its layout slot. The
            numbers stay.
          </p>
          <FeatureToggle
            id="goals"
            label="Goals"
            on={shell.enabled.goals}
            locked={!firstCleared}
          />
          <FeatureToggle
            id="linked-balances"
            label="Linked balances"
            on={shell.enabled.linkedBalances}
            locked={!firstCleared}
          />
        </section>
      ) : null}
    </div>
  );
}

function FeatureToggle({
  id,
  label,
  on,
  locked,
}: {
  id: FeatureId;
  label: string;
  on: boolean;
  locked: boolean;
}) {
  return (
    <label className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span>
        <span className="font-semibold">{label}</span>
        {locked ? <span className="ml-2 text-muted">after the first CLEARED row</span> : null}
      </span>
      <input
        type="checkbox"
        checked={on}
        disabled={locked && !on}
        onChange={(event) => enableFeature(id, event.target.checked)}
      />
    </label>
  );
}

export function GoalsWidget({ compact = false }: { compact?: boolean }) {
  const { goals } = useShell();
  const [name, setName] = useState("");
  const [allocated, setAllocated] = useState("");
  return (
    <article className="mt-8 rounded-2xl border border-line bg-white p-6">
      <h2 className="text-lg font-bold">Goals</h2>
      <p className="mt-1 text-sm text-muted">Manual allocated amount. Not Actual Savings.</p>
      {goals.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No goals yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {goals.map((goal) => (
            <li key={goal.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{goal.name}</span>
              <span className="tabular-nums">{formatAud(goal.allocated)}</span>
              <button type="button" onClick={() => deleteGoal(goal.id)} className="text-ink-soft underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {compact ? null : (
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = Number(allocated);
            if (!name.trim() || !Number.isFinite(amount)) return;
            saveGoal({ id: crypto.randomUUID(), name: name.trim(), allocated: amount });
            setName("");
            setAllocated("");
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          />
          <input
            value={allocated}
            onChange={(event) => setAllocated(event.target.value)}
            placeholder="Allocated"
            inputMode="decimal"
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-primary">
            Add
          </button>
        </form>
      )}
    </article>
  );
}

export function LinkedBalancesWidget({
  accounts,
}: {
  accounts: { id: string; label: string; net: number }[];
}) {
  const { linkedAccountIds } = useShell();
  const selected = accounts.filter((account) => linkedAccountIds.includes(account.id));
  return (
    <article className="mt-8 rounded-2xl border border-line bg-white p-6">
      <h2 className="text-lg font-bold">Linked balances</h2>
      <p className="mt-1 text-sm text-muted">Live CLEARED view. Not Actual Savings. Does not write the ledger.</p>
      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No accounts to link yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {accounts.map((account) => {
            const on = linkedAccountIds.includes(account.id);
            return (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      saveLinkedAccounts(
                        on ? linkedAccountIds.filter((id) => id !== account.id) : [...linkedAccountIds, account.id],
                      );
                    }}
                  />
                  <span className="font-semibold">{account.label}</span>
                </label>
                {on ? <span className="tabular-nums">{formatAud(account.net)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {selected.length === 0 && accounts.length > 0 ? (
        <p className="mt-3 text-sm text-muted">Tick an account to watch its CLEARED net.</p>
      ) : null}
    </article>
  );
}
