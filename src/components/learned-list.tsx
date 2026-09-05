"use client";

import { useState } from "react";
import { useMoneyFlow } from "@/components/money-flow-provider";
import { formatCount } from "@/lib/format";

/**
 * What the app has picked up from being corrected, as sentences.
 *
 * Corrections apply silently and immediately, which is only fair if the person can see
 * every one of them and take any of them back. So this is the other half of that decision,
 * not a settings page: a list of plain sentences about their own money, each with an undo.
 *
 * The words "rule", "pattern" and "engine" do not appear, because none of them describe
 * anything a person did. They told the app what a shop was.
 */
export function LearnedList() {
  const { learned, forgetLearned } = useMoneyFlow();
  const [open, setOpen] = useState(false);

  if (learned.length === 0) return null;

  return (
    <article className="mt-4 rounded-2xl border border-[#dce4df] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">What BitbyBit has learned</h2>
          <p className="mt-0.5 text-xs text-[#60716a]">
            From your corrections. Each one is applied to every movement of that merchant, including
            the ones in statements you have not uploaded yet.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="learned-list"
          onClick={() => setOpen(!open)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#edf4dc] px-2.5 py-1 text-xs font-semibold text-[#355a3f]"
        >
          {open ? "Hide" : `Show ${formatCount(learned.length)}`}
          <span aria-hidden="true" className={`inline-block leading-none ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </div>

      <ul id="learned-list" hidden={!open} className="mt-3 divide-y divide-[#edf0ee]">
        {learned.map((thing) => (
          <li className="flex flex-wrap items-center justify-between gap-2 py-1.5" key={thing.key}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{thing.sentence}</p>
              <p className="text-xs text-[#77857f]">
                {thing.count === 0
                  ? "No movements here yet — it will apply when one arrives"
                  : thing.count === 1
                    ? "Holding one movement"
                    : `Holding ${formatCount(thing.count)} movements`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => forgetLearned(thing.key)}
              className="shrink-0 text-sm font-semibold text-[#9b3b32]"
            >
              Forget this
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}
