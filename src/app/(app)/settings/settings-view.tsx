"use client";

import Link from "next/link";
import { useState } from "react";
import { saveDisplayName, signOut, useSession } from "@/components/session-store";
import { formatAud } from "@/lib/format";
import { useAppFont, writeAppFont } from "@/lib/font-choice";
import { canSignIn } from "@/lib/supabase/config";

const preview = `${formatAud(1842.4)} left to spend`;

export function SettingsView() {
  const font = useAppFont();

  return (
    <>
      <h1 className="text-[32px]">Settings</h1>
      <div className="mt-6 grid max-w-[880px] gap-5">
        <section className="card grid gap-4 p-6">
          <h2 className="text-[15px] font-bold">Accounts</h2>
          <AccountSection />
        </section>
        <section className="card grid gap-4 p-6">
          <h2 className="text-[15px] font-bold">App look</h2>
          <p className="text-[13px] font-semibold text-ink-soft">Font</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FontOption
              name="Public Sans"
              badge="Default"
              selected={font === "public-sans"}
              previewClass="font-preview-sans"
              onPick={() => writeAppFont("public-sans")}
            />
            <FontOption
              name="Geist Pixel"
              selected={font === "geist-pixel"}
              previewClass="font-preview-pixel"
              onPick={() => writeAppFont("geist-pixel")}
            />
          </div>
          <p className="text-[12.5px] text-muted">Saved on this device.</p>
        </section>
      </div>
    </>
  );
}

function AccountSection() {
  const session = useSession();
  if (!canSignIn()) {
    return <p className="text-sm text-muted">Signing in is not set up on this copy.</p>;
  }
  if (!session) {
    return (
      <p className="text-sm text-ink-soft">
        <Link href="/sign-in" className="font-semibold text-primary">
          Sign in
        </Link>{" "}
        to see your account.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <NameBlock name={session.name} email={session.email} />
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-full border-2 border-line bg-surface px-4 py-2 text-sm font-semibold text-ink"
      >
        Sign out
      </button>
    </div>
  );
}

function NameBlock({ name, email }: { name: string; email: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setPending(true);
    const result = await saveDisplayName(draft);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError("");
    setEditing(false);
  }

  if (editing) {
    return (
      <form onSubmit={(event) => void save(event)} className="grid gap-2">
        <label className="text-[12.5px] text-muted" htmlFor="account-name">
          Name
        </label>
        <input
          id="account-name"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          className="w-full max-w-sm rounded-[var(--radius-inner)] border-2 border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="text-sm font-semibold text-primary disabled:opacity-35">
            Save
          </button>
          <button
            type="button"
            className="text-sm font-semibold text-muted"
            onClick={() => {
              setDraft(name);
              setError("");
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-[12.5px] text-primary">{error}</p> : null}
        <p className="text-[13px] text-muted">{email}</p>
      </form>
    );
  }

  if (!name) {
    return (
      <div>
        <p className="text-[15.5px] font-bold">{email || "Signed in"}</p>
        <button
          type="button"
          className="mt-1 text-[13px] font-semibold text-primary"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          Add your name
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-[15.5px] font-bold">{name}</p>
        <button
          type="button"
          aria-label="Edit name"
          className="text-muted"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted">{email}</p>
    </div>
  );
}

function FontOption({
  name,
  badge,
  selected,
  previewClass,
  onPick,
}: {
  name: string;
  badge?: string;
  selected: boolean;
  previewClass: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`grid gap-3 rounded-[var(--radius-card)] border-2 p-4 text-left ${
        selected ? "border-primary bg-accent-surface" : "border-line bg-surface"
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold">{name}</span>
          {badge ? <span className="text-[12.5px] text-muted">{badge}</span> : null}
        </span>
        <span
          className={`grid size-5 place-items-center rounded-full border-2 ${
            selected ? "border-primary bg-primary text-on-primary" : "border-line"
          }`}
          aria-hidden
        >
          {selected ? (
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : null}
        </span>
      </span>
      <span className={`text-sm tabular-nums ${previewClass}`}>{preview}</span>
    </button>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}
