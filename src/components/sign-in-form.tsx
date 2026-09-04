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
      <div className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
        <p className="text-sm text-[#52625c]">
          Signed in as <span className="font-semibold">{session.email}</span>. Your ledger is backed
          up as you change it.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="rounded-full bg-[#173b31] px-4 py-2 text-sm font-semibold text-white"
          >
            Back to the dashboard
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-full border border-[#dce4df] px-4 py-2 text-sm font-semibold text-[#355a3f]"
          >
            Sign out
          </button>
        </div>
        <p className="mt-3 text-xs text-[#60716a]">
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
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-[#dce4df] bg-white p-6">
      <label className="block text-sm font-semibold" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1 w-full rounded-xl border border-[#dce4df] px-3 py-2 text-sm"
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
        className="mt-1 w-full rounded-xl border border-[#dce4df] px-3 py-2 text-sm"
        required
      />
      {making && password.length > 0 && tooShort ? (
        <p className="mt-1 text-xs text-[#8a5a2b]">{tooShort}</p>
      ) : null}

      {problem ? <p className="mt-4 text-sm font-semibold text-[#8a2b2b]">{problem}</p> : null}
      {note ? <p className="mt-4 text-sm font-semibold text-[#355a3f]">{note}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-full bg-[#173b31] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
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
        className="mt-3 w-full text-sm font-semibold text-[#355a3f] underline"
      >
        {making ? "I already have an account" : "I need an account"}
      </button>

      <p className="mt-4 text-xs text-[#60716a]">
        Statements already in this browser are kept and added to the account, not replaced.
      </p>
    </form>
  );
}
