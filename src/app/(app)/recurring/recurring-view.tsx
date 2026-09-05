"use client";

import { useMemo, useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { useRecurringStore, type TrackedRecurring } from "@/components/recurring-store";
import { SummaryCard } from "@/components/summary-card";
import { formatAud } from "@/lib/format";
import { formatDisplayDate } from "@/lib/money-flow/parse-values";
import { inPeriod } from "@/lib/money-flow/period";
import {
  cadenceLabel,
  detectRecurringOutflows,
  monthlyEquivalent,
  nextDateFromLast,
  statusLabel,
  trackedInPeriod,
  trackingSnapshot,
  type Cadence,
  type DetectedRecurring,
  type TrackingSnapshot,
  type TrackingStatus,
} from "@/lib/money-flow/recurring";

export function RecurringView() {
  const { allTransactions, flow, hasUploads, period } = useMoneyFlow();
  const { ignored, confirmed, custom, confirmPayment, ignorePayment, stopTracking, addCustomPayment, updatePayment, markPaid } =
    useRecurringStore();
  const detected = useMemo(() => detectRecurringOutflows(allTransactions), [allTransactions]);
  const confirmedFingerprints = new Set(confirmed.map((item) => item.fingerprint));
  const suggestions = detected.filter(
    (item) =>
      !ignored.has(item.fingerprint) &&
      !confirmedFingerprints.has(item.fingerprint) &&
      item.dates.some((date) => inPeriod(date, period)),
  );
  const tracked = [...confirmed, ...custom]
    .filter((item) => trackedInPeriod(item, period, allTransactions))
    .sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999"));
  const monthlyTotal = tracked.reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.cadence), 0);
  const today = todayIso();
  const paidCount = tracked.filter(
    (item) => trackingSnapshot(item, allTransactions, period, today).status === "paid",
  ).length;

  return (
    <>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">{flow.periodLabel}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Recurring payments</h1>
      <p className="mt-2 max-w-2xl text-[#60716a]">
        {hasUploads
          ? "Track repeating money out from your documents. BitbyBit matches them against activity in this period."
          : "Add a repeating payment to track it. Upload a statement and BitbyBit will also suggest them from your own activity."}
      </p>
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Tracked payments"
          value={String(tracked.length)}
          detail={tracked.length === 0 ? "Confirm a suggestion or add a payment" : `${paidCount} paid in this period`}
        />
        <SummaryCard
          label="Typical monthly out"
          value={formatAud(monthlyTotal)}
          detail="From tracked payments in this period"
        />
        <SummaryCard label="Suggestions" value={String(suggestions.length)} detail="Seen in this period" />
      </section>

      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Tracked</h2>
        {tracked.length === 0 ? (
          <p className="mt-4 text-sm text-[#60716a]">
            {period.kind === "all"
              ? "Nothing tracked yet. Confirm a suggestion or add a payment."
              : "Nothing tracked is due in this period."}
          </p>
        ) : (
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {tracked.map((item) => (
              <TrackedRow
                key={item.id}
                item={item}
                snapshot={trackingSnapshot(item, allTransactions, period, today)}
                onDateChange={(nextDate) => updatePayment(item.id, { nextDate })}
                onMarkPaid={() => markPaid(item.id, today)}
                onStop={() => stopTracking(item.id)}
              />
            ))}
          </div>
        )}
      </article>

      <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <h2 className="text-lg font-bold">Suggested from activity</h2>
        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#60716a]">
            {period.kind === "all" ? "No repeating money out to suggest right now." : "No repeating money out in this period."}
          </p>
        ) : (
          <div className="mt-4 divide-y divide-[#edf0ee]">
            {suggestions.map((item) => (
              <SuggestionRow
                key={item.fingerprint}
                item={item}
                today={today}
                onTrack={(nextDate) =>
                  confirmPayment({
                    fingerprint: item.fingerprint,
                    name: item.merchant,
                    amount: item.typicalAmount,
                    cadence: item.cadence,
                    nextDate,
                  })
                }
                onIgnore={() => ignorePayment(item.fingerprint)}
              />
            ))}
          </div>
        )}
      </article>

      <AddPaymentForm today={today} onAdd={addCustomPayment} />
    </>
  );
}

function TrackedRow({
  item,
  snapshot,
  onDateChange,
  onMarkPaid,
  onStop,
}: {
  item: TrackedRecurring;
  snapshot: TrackingSnapshot;
  onDateChange: (nextDate: string) => void;
  onMarkPaid: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{item.name}</p>
          <StatusBadge status={snapshot.status} />
        </div>
        <p className="mt-1 text-sm text-[#77857f]">
          {formatAud(item.amount)} · {cadenceLabel(item.cadence)} · about {formatAud(monthlyEquivalent(item.amount, item.cadence))} / month
          {snapshot.matchedDate ? ` · seen ${formatDisplayDate(snapshot.matchedDate)}` : ""}
          {item.nextDate ? ` · next ${formatDisplayDate(item.nextDate)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#60716a]">
          Date
          <input
            type="date"
            value={item.nextDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="ml-2 rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#173b31]"
          />
        </label>
        {snapshot.status === "paid" ? null : (
          <button type="button" className="text-sm font-semibold text-[#355a3f]" onClick={onMarkPaid}>
            Mark paid
          </button>
        )}
        <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={onStop}>
          Stop tracking
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TrackingStatus }) {
  const tone =
    status === "paid"
      ? "bg-[#edf4dc] text-[#257155]"
      : status === "overdue"
        ? "bg-[#f8e8e6] text-[#9b3b32]"
        : status === "due"
          ? "bg-[#173b31] text-white"
          : "bg-[#edf0ee] text-[#60716a]";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{statusLabel(status)}</span>;
}

function SuggestionRow({
  item,
  today,
  onTrack,
  onIgnore,
}: {
  item: DetectedRecurring;
  today: string;
  onTrack: (nextDate: string) => void;
  onIgnore: () => void;
}) {
  const [nextDate, setNextDate] = useState(() => nextDateFromLast(item.lastDateIso, item.cadence, today));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <p className="font-semibold">{item.merchant}</p>
        <p className="mt-1 text-sm text-[#77857f]">
          {formatAud(item.typicalAmount)} · {cadenceLabel(item.cadence)}
          {item.suggested ? " · seen once this period" : ` · ${item.count} times`}
          {item.lastDate ? ` · last ${item.lastDate}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#60716a]">
          Date
          <input
            type="date"
            value={nextDate}
            onChange={(event) => setNextDate(event.target.value)}
            className="ml-2 rounded-full border border-[#dce4df] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#173b31]"
          />
        </label>
        <button type="button" className="text-sm font-semibold text-[#355a3f]" onClick={() => onTrack(nextDate)}>
          Track
        </button>
        <button type="button" className="text-sm font-semibold text-[#9b3b32]" onClick={onIgnore}>
          Ignore
        </button>
      </div>
    </div>
  );
}

function AddPaymentForm({
  today,
  onAdd,
}: {
  today: string;
  onAdd: (name: string, amount: number, cadence: Cadence, nextDate: string) => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [nextDate, setNextDate] = useState(today);

  return (
    <article className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <h2 className="text-lg font-bold">Add a payment</h2>
      <form
        className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_8rem_10rem_11rem_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!name.trim() || !Number.isFinite(value) || value <= 0 || !nextDate) return;
          onAdd(name.trim(), value, cadence, nextDate);
          setName("");
          setAmount("");
          setCadence("monthly");
          setNextDate(today);
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
        <label className="text-sm">
          <span className="mb-1 block text-[#60716a]">Date</span>
          <input
            type="date"
            value={nextDate}
            onChange={(event) => setNextDate(event.target.value)}
            required
            className="w-full rounded-full border border-[#dce4df] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#173b31]"
          />
        </label>
        <button type="submit" className="rounded-full bg-[#173b31] px-5 py-2.5 text-sm font-semibold text-white">
          Add
        </button>
      </form>
    </article>
  );
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
