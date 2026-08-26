"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { useRecurringStore } from "@/components/recurring-store";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import {
  cadenceLabel,
  detectRecurringOutflows,
  monthlyEquivalent,
  type Cadence,
} from "@/lib/money-flow/recurring";

export function RecurringView() {
  const { transactions, usingDemo } = useMoneyFlow();
  const { ignored, confirmed, custom, confirmPayment, ignorePayment, stopTracking, addCustomPayment } =
    useRecurringStore();
  const detected = useMemo(() => detectRecurringOutflows(transactions), [transactions]);
  const confirmedFingerprints = new Set(confirmed.map((item) => item.fingerprint));
  const suggestions = detected.filter(
    (item) => !ignored.has(item.fingerprint) && !confirmedFingerprints.has(item.fingerprint),
  );
  const tracked = [...confirmed, ...custom];
  const monthlyTotal = tracked.reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.cadence), 0);

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Money out on a schedule</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Recurring payments</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        {usingDemo
          ? "BitbyBit looks through sample activity for repeating money out. Confirm a suggestion, ignore it, or add a payment yourself."
          : "Repeating money out from your documents. Confirm what to track, ignore the rest, or add a payment by hand."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Tracked payments" value={String(tracked.length)} detail="Confirmed and added by you" />
        <SummaryCard
          label="Typical monthly out"
          value={formatAud(monthlyTotal)}
          detail="From tracked payments"
        />
        <SummaryCard label="Suggestions" value={String(suggestions.length)} detail="From this period's activity" />
      </section>

      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Tracked</h2>
        {tracked.length === 0 ? (
          <p className="mt-4 text-sm text-[#60716a]">Nothing tracked yet. Confirm a suggestion or add a payment.</p>
        ) : (
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {tracked.map((item) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-4" key={item.id}>
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1 text-sm text-[#77857f]">
                    {formatAud(item.amount)} · {cadenceLabel(item.cadence)} · about {formatAud(monthlyEquivalent(item.amount, item.cadence))} / month
                  </p>
                </div>
                <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={() => stopTracking(item.id)}>
                  Stop tracking
                </button>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Suggested from activity</h2>
        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#60716a]">No repeating money out to suggest right now.</p>
        ) : (
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {suggestions.map((item) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-4" key={item.fingerprint}>
                <div>
                  <p className="font-semibold">{item.merchant}</p>
                  <p className="mt-1 text-sm text-[#77857f]">
                    {formatAud(item.typicalAmount)} · {cadenceLabel(item.cadence)}
                    {item.suggested ? " · seen once this period" : ` · ${item.count} times`}
                    {item.lastDate ? ` · last ${item.lastDate}` : ""}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-sm font-semibold text-[#355a3f]"
                    onClick={() =>
                      confirmPayment({
                        fingerprint: item.fingerprint,
                        name: item.merchant,
                        amount: item.typicalAmount,
                        cadence: item.cadence,
                      })
                    }
                  >
                    Track
                  </button>
                  <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={() => ignorePayment(item.fingerprint)}>
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <AddPaymentForm onAdd={addCustomPayment} />
    </>
  );
}

function AddPaymentForm({ onAdd }: { onAdd: (name: string, amount: number, cadence: Cadence) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");

  return (
    <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <h2 className="text-lg font-bold">Add a payment</h2>
      <form
        className="mt-5 grid gap-3 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!name.trim() || !Number.isFinite(value) || value <= 0) return;
          onAdd(name.trim(), value, cadence);
          setName("");
          setAmount("");
          setCadence("monthly");
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-[#60716a]">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Rent, Netflix…"
            className="w-full rounded-full border border-[#dce4df] px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[#60716a]">Amount</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-full border border-[#dce4df] px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[#60716a]">How often</span>
          <select
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
            className="w-full rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
          >
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
            <option value="unknown">Not sure</option>
          </select>
        </label>
        <button type="submit" className="rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
          Add
        </button>
      </form>
    </article>
  );
}
