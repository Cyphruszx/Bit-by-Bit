"use client";

import { useSyncExternalStore, useState } from "react";
import {
  pendingMigrationOffer,
  submitMigrationDecision,
  subscribeMigrationOffer,
} from "@/lib/store/guest-migrate-offer";
import { REPLACE_CONFIRM_PHRASE } from "@/lib/store/guest-migrate";

/**
 * Spec 4 choice when this browser and the account both hold work.
 * Replace with guest is an irreversible wipe and needs the scary phrase.
 */
export function GuestMigrateDialog() {
  const offer = useSyncExternalStore(subscribeMigrationOffer, pendingMigrationOffer, () => null);
  const [action, setAction] = useState<"merge" | "keep-account" | "replace-guest">("merge");
  const [confirm, setConfirm] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  if (!offer || offer.kind !== "choose") return null;

  const submit = () => {
    setProblem(null);
    if (action === "replace-guest") {
      if (confirm !== REPLACE_CONFIRM_PHRASE) {
        setProblem(`Type ${REPLACE_CONFIRM_PHRASE} to permanently replace the account.`);
        return;
      }
      submitMigrationDecision({ action: "replace-guest", confirm });
      return;
    }
    if (action === "keep-account") {
      submitMigrationDecision({ action: "keep-account" });
      return;
    }
    const accountMatches = { ...offer.matches.mapped };
    for (const [guestId, accountId] of Object.entries(picks)) {
      if (accountId) accountMatches[guestId] = accountId;
    }
    submitMigrationDecision({ action: "merge", accountMatches });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-4">
      <section className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-lg">
        <h2 className="text-lg font-bold">This browser and the account both have statements</h2>
        <p className="mt-2 text-sm text-muted">
          Choose what to keep. Merge puts disagreements on the Review Queue. Replace with guest
          permanently deletes the account copy.
        </p>

        <fieldset className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="migrate"
              checked={action === "merge"}
              onChange={() => setAction("merge")}
            />
            <span>
              <span className="font-semibold">Merge</span> — keep both, match accounts, open
              conflicts in Review Queue
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="migrate"
              checked={action === "keep-account"}
              onChange={() => setAction("keep-account")}
            />
            <span>
              <span className="font-semibold">Keep account only</span> — leave this browser&apos;s
              guest statements behind
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="migrate"
              checked={action === "replace-guest"}
              onChange={() => setAction("replace-guest")}
            />
            <span>
              <span className="font-semibold text-negative-strong">Replace with guest</span> —
              irreversible wipe of the account ledger
            </span>
          </label>
        </fieldset>

        {action === "merge" && offer.matches.needsPick.length > 0 ? (
          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="text-sm font-semibold">Which account is which?</p>
            <p className="mt-1 text-xs text-muted">
              Same name, more than one match. Pick the account copy, or keep the guest as new.
            </p>
            <ul className="mt-2 space-y-2">
              {offer.matches.needsPick.map((pick) => (
                <li key={pick.guest.id}>
                  <label className="block text-xs font-semibold" htmlFor={`pick-${pick.guest.id}`}>
                    {pick.guest.name} ({pick.guest.kind})
                  </label>
                  <select
                    id={`pick-${pick.guest.id}`}
                    className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm"
                    value={picks[pick.guest.id] ?? ""}
                    onChange={(event) =>
                      setPicks((held) => ({ ...held, [pick.guest.id]: event.target.value }))
                    }
                  >
                    <option value="">Keep as a new account</option>
                    {pick.candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ({candidate.kind})
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {action === "replace-guest" ? (
          <div className="mt-4 rounded-xl border border-attention-line bg-attention-surface p-3">
            <p className="text-sm font-semibold text-attention-ink">
              This permanently deletes the account ledger. There is no undo.
            </p>
            <label className="mt-2 block text-xs font-semibold" htmlFor="replace-confirm">
              Type {REPLACE_CONFIRM_PHRASE}
            </label>
            <input
              id="replace-confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>
        ) : null}

        {problem ? <p className="mt-3 text-sm font-semibold text-negative-strong">{problem}</p> : null}

        <button
          type="button"
          onClick={submit}
          className="mt-5 w-full rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
        >
          Continue
        </button>
      </section>
    </div>
  );
}
