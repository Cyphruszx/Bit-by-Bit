"use client";

import { useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { SavingsPathChart, SavingsPotLinesChart, SetAsideLineChart } from "@/components/savings-charts";
import { useSavingsPots } from "@/components/savings-store";
import { ProgressBar } from "@/components/progress-bar";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { monthlyTransferSeries, monthsToPot, type SavingsPot } from "@/lib/money-flow/savings";

export function SavingsView() {
  const { flow, hasUploads, transactions } = useMoneyFlow();
  const { pots, snapshots, addPot, updatePot, removePot } = useSavingsPots();
  const saved = pots.reduce((sum, pot) => sum + pot.saved, 0);
  const target = pots.reduce((sum, pot) => sum + pot.target, 0);
  const monthly = pots.reduce((sum, pot) => sum + pot.monthlyContribution, 0);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Bit by bit</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Savings</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        Track pots toward the things you are saving for. Edits stay in this browser. Uploaded transfers show as money
        set aside this period, not spending.
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Saved toward pots" value={formatAud(saved)} detail={`${pots.length} active pots`} positive />
        <SummaryCard label="Combined target" value={formatAud(target)} detail="Across your savings pots" />
        <SummaryCard
          label={hasUploads ? "Set aside this period" : "Monthly contributions"}
          value={formatAud(hasUploads ? flow.transfers : monthly)}
          detail={hasUploads ? flow.periodLabel : "Planned each month"}
          positive
        />
      </section>
      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Path to target</h2>
        <p className="mt-1 text-sm text-[#60716a]">
          Combined saved amount over the coming months at your current contributions, with the combined target as a
          dashed line.
        </p>
        <div className="mt-5">
          <SavingsPathChart pots={pots} snapshots={snapshots} />
        </div>
      </article>
      {pots.length > 1 ? (
        <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
          <h2 className="text-lg font-bold">Each pot</h2>
          <p className="mt-1 text-sm text-[#60716a]">How every pot grows if you keep the same monthly amount.</p>
          <div className="mt-5">
            <SavingsPotLinesChart pots={pots} />
          </div>
        </article>
      ) : null}
      {hasUploads && monthlyTransferSeries(transactions).length >= 2 ? (
        <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
          <h2 className="text-lg font-bold">Set aside by month</h2>
          <p className="mt-1 text-sm text-[#60716a]">Transfers from the documents you uploaded, grouped by month.</p>
          <div className="mt-5">
            <SetAsideLineChart transactions={transactions} />
          </div>
        </article>
      ) : null}
      <AddPotForm onAdd={addPot} />
      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {pots.length === 0 ? (
          <p className="text-sm text-[#60716a]">No savings pots yet. Add one above.</p>
        ) : (
          pots.map((pot) => (
            <PotCard key={pot.id} pot={pot} onSave={(patch) => updatePot(pot.id, patch)} onRemove={() => removePot(pot.id)} />
          ))
        )}
      </section>
    </>
  );
}

function AddPotForm({ onAdd }: { onAdd: (pot: Omit<SavingsPot, "id">) => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [monthly, setMonthly] = useState("");

  return (
    <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <h2 className="text-lg font-bold">Add a pot</h2>
      <form
        className="mt-5 grid gap-3 md:grid-cols-4 md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const targetValue = Number(target);
          if (!name.trim() || !Number.isFinite(targetValue) || targetValue <= 0) return;
          onAdd({
            name: name.trim(),
            detail: "Saved in this browser",
            saved: Number(saved) || 0,
            target: targetValue,
            monthlyContribution: Number(monthly) || 0,
          });
          setName("");
          setTarget("");
          setSaved("");
          setMonthly("");
        }}
      >
        <Field label="Name" value={name} onChange={setName} placeholder="Emergency fund" />
        <Field label="Already saved" value={saved} onChange={setSaved} placeholder="0" />
        <Field label="Target" value={target} onChange={setTarget} placeholder="10000" />
        <div className="flex items-end gap-2">
          <Field label="Each month" value={monthly} onChange={setMonthly} placeholder="0" />
          <button type="submit" className="mb-0.5 rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
            Add
          </button>
        </div>
      </form>
    </article>
  );
}

function PotCard({
  pot,
  onSave,
  onRemove,
}: {
  pot: SavingsPot;
  onSave: (patch: Partial<Omit<SavingsPot, "id">>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pot.name);
  const [saved, setSaved] = useState(String(pot.saved));
  const [target, setTarget] = useState(String(pot.target));
  const [monthly, setMonthly] = useState(String(pot.monthlyContribution));
  const remaining = Math.max(0, pot.target - pot.saved);
  const percent = pot.target > 0 ? Math.round((pot.saved / pot.target) * 100) : 0;
  const months = monthsToPot(pot);

  return (
    <article className="rounded-2xl border border-[#dce4df] bg-white p-6">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              name: name.trim() || pot.name,
              saved: Number(saved) || 0,
              target: Number(target) || pot.target,
              monthlyContribution: Number(monthly) || 0,
            });
            setEditing(false);
          }}
        >
          <Field label="Name" value={name} onChange={setName} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Saved" value={saved} onChange={setSaved} />
            <Field label="Target" value={target} onChange={setTarget} />
            <Field label="Monthly" value={monthly} onChange={setMonthly} />
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" className="text-sm font-semibold text-[#355a3f]">
              Save
            </button>
            <button type="button" className="text-sm text-[#60716a]" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <h2 className="text-lg font-bold">{pot.name}</h2>
          <p className="mt-1 text-sm text-[#60716a]">{pot.detail}</p>
          <p className="mt-5 text-2xl font-bold">{formatAud(pot.saved)}</p>
          <p className="mt-1 text-sm text-[#77857f]">of {formatAud(pot.target)}</p>
          <ProgressBar value={percent} />
          <p className="mt-4 text-sm text-[#52625c]">
            {formatAud(pot.monthlyContribution)} each month
            {months === 0 ? " · reached" : months == null ? "" : ` · about ${months} months to go`}
            {remaining > 0 ? ` · ${formatAud(remaining)} left` : ""}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className="text-sm font-semibold text-[#355a3f]"
              onClick={() => {
                setName(pot.name);
                setSaved(String(pot.saved));
                setTarget(String(pot.target));
                setMonthly(String(pot.monthlyContribution));
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={onRemove}>
              Remove
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1 block text-[#60716a]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full border border-[#dce4df] px-3 py-2 text-sm outline-none focus:border-[#173b31]"
      />
    </label>
  );
}
