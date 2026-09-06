"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn, signOut, signUp, useSession } from "@/components/session-store";
import { passwordError } from "@/lib/auth/credentials";

/**
 * Signing in, or making an account. One form for both, because the fields are the same and
 * a person arriving here has not decided which they are doing yet.
 */
export function SignInForm() {
  const session = useSession();
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
        <p className="text-sm text-muted">
          Signed in as <span className="font-semibold">{session.email}</span>. Your ledger is backed
          up as you change it.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
          >
            Back to the dashboard
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
          >
            Sign out
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Signing out leaves this browser&apos;s copy alone. To remove your statements everywhere,
          use Clear on the upload screen.
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setNote(null);
    setBusy(true);

    const result = making ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (making) {
      // Whether a confirmation email is needed is the project's setting, not something the
      // form can know, so this says what to expect either way.
      setNote("Account made. If your project asks for email confirmation, check your inbox.");
      return;
    }
    router.push("/dashboard");
  };

  const tooShort = making ? passwordError(password) : null;

  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-line bg-surface p-6">
      <label className="block text-sm font-semibold" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm"
        required
      />

      <label className="mt-4 block text-sm font-semibold" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete={making ? "new-password" : "current-password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm"
        required
      />
      {making && password.length > 0 && tooShort ? (
        <p className="mt-1 text-xs text-attention">{tooShort}</p>
      ) : null}

      {problem ? <p className="mt-4 text-sm font-semibold text-negative-strong">{problem}</p> : null}
      {note ? <p className="mt-4 text-sm font-semibold text-ink-soft">{note}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-60"
      >
        {busy ? "One moment…" : making ? "Make an account" : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMaking(!making);
          setProblem(null);
          setNote(null);
        }}
        className="mt-3 w-full text-sm font-semibold text-ink-soft underline"
      >
        {making ? "I already have an account" : "I need an account"}
      </button>

      <p className="mt-4 text-xs text-muted">
        Statements already in this browser are kept and added to the account, not replaced —
        unless they belong to someone else who signed in here, which stay theirs.
      </p>
    </form>
  );
}
