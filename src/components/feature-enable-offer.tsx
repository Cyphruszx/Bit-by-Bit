"use client";

import { useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { ENABLE_OFFER_KEYS, ENABLE_OFFER_LABELS, hasClearedMovement, shouldShowEnableOffer, type EnableOfferKey } from "@/lib/money-flow/features";

/**
 * Spec 5: after the first CLEARED row, offer Goals, Linked balances, and Pools.
 * Cash Flow / Recurring stay off this list. Budget waits for Spec 13.
 */
export function FeatureEnableOffer() {
  const { allTransactions, acceptEnableOffer, dismissEnableOffer, featureOffer, featureToggles } = useMoneyFlow();
  const [selected, setSelected] = useState<EnableOfferKey[]>([...ENABLE_OFFER_KEYS]);
  const visible = shouldShowEnableOffer(featureToggles, featureOffer, hasClearedMovement(allTransactions));
  if (!visible) return null;

  const toggle = (key: EnableOfferKey) => {
    setSelected((held) => (held.includes(key) ? held.filter((item) => item !== key) : [...held, key]));
  };

  return (
    <section className="mt-8 rounded-2xl border border-attention-line bg-attention-surface p-6">
      <h2 className="text-lg font-bold">Turn on extra Core features?</h2>
      <p className="mt-2 text-sm text-attention-ink">
        Your first cleared movements are in. Enable Goals, Linked balances, and Pools when you want
        them — or leave them off and turn them on later.
      </p>
      <ul className="mt-4 space-y-2">
        {ENABLE_OFFER_KEYS.map((key) => (
          <li key={key}>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={() => toggle(key)}
              />
              {ENABLE_OFFER_LABELS[key]}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => acceptEnableOffer(selected)}
          className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white"
        >
          Enable selected
        </button>
        <button
          type="button"
          onClick={dismissEnableOffer}
          className="rounded-full border border-line bg-white px-4 py-1.5 text-sm font-semibold text-ink-soft"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

export function OptionalFeaturesPanel() {
  const { allTransactions, featureOn, setFeatureOn } = useMoneyFlow();
  const hasCleared = hasClearedMovement(allTransactions);
  if (!hasCleared) return null;

  return (
    <details className="mt-8 rounded-2xl border border-line bg-white p-6">
      <summary className="cursor-pointer text-lg font-bold">Optional features</summary>
      <p className="mt-2 text-sm text-muted">
        Goals, Linked balances, and Pools stay off until you enable them. Turning one off hides it
        without deleting what you already set up.
      </p>
      <ul className="mt-4 space-y-3">
        {ENABLE_OFFER_KEYS.map((key) => {
          const on = featureOn(key);
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">{ENABLE_OFFER_LABELS[key]}</p>
              <button
                type="button"
                onClick={() => setFeatureOn(key, !on)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                  on ? "border border-line bg-white text-ink-soft" : "bg-primary text-white"
                }`}
              >
                {on ? "Turn off" : "Enable"}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
