"use client";

import { useSyncExternalStore } from "react";
import { rehydrateLedger } from "@/components/money-flow-provider";
import { emailError, passwordError, signInMessage } from "@/lib/auth/credentials";
import { supabase } from "@/lib/supabase/client";

/**
 * Who is signed in, if anyone.
 *
 * Held in one place the way the scope is, so the header and the sign-in page always agree.
 * Signing in or out re-reads the ledger, because the store it should be saving to has just
 * changed and the two copies have not met yet — that meeting is where the merge happens.
 */

export type Session = { email: string; userId: string } | null;

const listeners = new Set<() => void>();
let session: Session = null;
let watching = false;

export function useSession(): Session {
  return useSyncExternalStore(subscribe, () => session, () => null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watch();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Starts listening once, on the first component that cares. Supabase tells us about the
 * session it restored from this browser as well as about later changes, so there is no
 * separate first read to race against.
 */
function watch() {
  if (watching) return;
  const client = supabase();
  if (!client) return;
  watching = true;

  client.auth.onAuthStateChange((_event, next) => {
    const who = next?.user ? { email: next.user.email ?? "", userId: next.user.id } : null;
    const changed = who?.userId !== session?.userId;
    session = who;
    listeners.forEach((listener) => listener());
    // Only when the person actually changed: a token refresh is not a reason to re-read
    // the whole ledger.
    if (changed) void rehydrateLedger();
  });
}

export type AuthResult = { ok: true } | { ok: false; message: string };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const client = supabase();
  if (!client) return { ok: false, message: "Signing in is not set up on this copy." };

  const wrong = emailError(email);
  if (wrong) return { ok: false, message: wrong };

  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { ok: false, message: signInMessage(error.message) } : { ok: true };
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const client = supabase();
  if (!client) return { ok: false, message: "Signing in is not set up on this copy." };

  const wrong = emailError(email) ?? passwordError(password);
  if (wrong) return { ok: false, message: wrong };

  const { error } = await client.auth.signUp({ email: email.trim(), password });
  if (!error) return { ok: true };
  // A duplicate address is told plainly: the person is trying to make their own account,
  // so hiding it from them helps nobody.
  return {
    ok: false,
    message: /already|exists|registered/i.test(error.message)
      ? "There is already an account with that email. Try signing in."
      : signInMessage(error.message),
  };
}

/**
 * Signs out and leaves the browser's copy of the ledger exactly where it is. Somebody
 * stepping away from a shared machine wants Clear on the upload screen, which removes both
 * copies; signing out is not that, and quietly wiping their statements would be a surprise.
 */
export async function signOut(): Promise<void> {
  const client = supabase();
  if (!client) return;
  await client.auth.signOut();
}
