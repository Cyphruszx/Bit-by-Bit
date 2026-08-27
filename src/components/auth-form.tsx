"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendMagicLink, signInWithPassword, signUpWithPassword, type AuthState } from "@/app/actions/auth";

const initial: AuthState = {};

export function AuthForm({
  mode,
  cloudConfigured,
  callbackError,
}: {
  mode: "signin" | "signup";
  cloudConfigured: boolean;
  callbackError?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [passwordState, passwordAction] = useActionState(mode === "signup" ? signUpWithPassword : signInWithPassword, initial);
  const [magicState, magicAction] = useActionState(sendMagicLink, initial);
  const state = magicState.message || magicState.error ? magicState : passwordState;

  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-[#dce4df] bg-white p-8">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#527166]">Account</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{mode === "signup" ? "Create an account" : "Sign in"}</h1>
      <p className="mt-3 text-[#52625c]">
        {mode === "signup"
          ? "Save interpreted money flow, recurring payments, and savings pots to your account."
          : "Your session stays in an httpOnly cookie. Sign out when you leave a shared computer."}
      </p>
      {!cloudConfigured ? (
        <p className="mt-6 rounded-2xl bg-[#f8ece9] px-4 py-3 text-sm text-[#9b3b32]">
          Cloud sign-in is not configured in this environment. You can still use BitbyBit with demo data on this
          device.
        </p>
      ) : null}
      {callbackError ? (
        <p className="mt-6 rounded-2xl bg-[#f8ece9] px-4 py-3 text-sm text-[#9b3b32]">
          That sign-in link could not be completed. Request a new one.
        </p>
      ) : null}
      <form action={passwordAction} className="mt-6 space-y-4">
        {mode === "signup" ? (
          <label className="block text-sm font-semibold text-[#355a3f]">
            Display name
            <input
              name="displayName"
              autoComplete="name"
              className="mt-1 w-full rounded-2xl border border-[#dce4df] px-4 py-3 font-medium text-[#17211e]"
            />
          </label>
        ) : null}
        <label className="block text-sm font-semibold text-[#355a3f]">
          Email
          <input
            name="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="mt-1 w-full rounded-2xl border border-[#dce4df] px-4 py-3 font-medium text-[#17211e]"
          />
        </label>
        <label className="block text-sm font-semibold text-[#355a3f]">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? 12 : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="mt-1 w-full rounded-2xl border border-[#dce4df] px-4 py-3 font-medium text-[#17211e]"
          />
        </label>
        {mode === "signup" ? (
          <p className="text-sm text-[#60716a]">At least 12 characters, including a letter and a number.</p>
        ) : null}
        <SubmitButton disabled={!cloudConfigured} label={mode === "signup" ? "Create account" : "Sign in"} />
      </form>
      <form action={magicAction} className="mt-4">
        <input type="hidden" name="email" value={email} />
        <p className="text-sm text-[#60716a]">Or send a one-time link to the same email.</p>
        <MagicLinkButton disabled={!cloudConfigured} />
      </form>
      {state.error ? <p className="mt-4 text-sm text-[#9b3b32]">{state.error}</p> : null}
      {state.message ? <p className="mt-4 text-sm text-[#257155]">{state.message}</p> : null}
      <p className="mt-6 text-sm text-[#52625c]">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/signin" className="font-semibold text-[#355a3f]">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link href="/signup" className="font-semibold text-[#355a3f]">
              Create one
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="w-full rounded-full bg-[#173b31] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Please wait…" : label}
    </button>
  );
}

function MagicLinkButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-3 w-full rounded-full border border-[#dce4df] px-5 py-3 text-sm font-semibold text-[#355a3f] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Sending link…" : "Email me a sign-in link"}
    </button>
  );
}
