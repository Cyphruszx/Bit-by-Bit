"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isEmail, passwordError } from "@/lib/auth/password";
import { assertSameOrigin, clientIp } from "@/lib/security/origin";
import { rateLimit } from "@/lib/security/rate-limit";
import { safeInternalPath } from "@/lib/security/redirect";
import { isSupabaseConfigured, LAST_ACTIVE_COOKIE } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  message?: string;
};

async function guardAuth(): Promise<AuthState | null> {
  if (!isSupabaseConfigured()) {
    return {
      error: "Cloud sign-in is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    };
  }
  try {
    await assertSameOrigin();
  } catch {
    return { error: "Invalid request origin." };
  }
  const ip = await clientIp();
  if (!rateLimit(`auth:${ip}`, 8, 15 * 60 * 1000)) {
    return { error: "Too many sign-in attempts. Try again in a few minutes." };
  }
  return null;
}

function redirectTo(formData: FormData) {
  return safeInternalPath(String(formData.get("next") ?? "/dashboard"));
}

async function requestOrigin() {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin) return origin;
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

export async function signInWithPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const blocked = await guardAuth();
  if (blocked) return blocked;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email or password is incorrect." };
  redirect(redirectTo(formData));
}

export async function signUpWithPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const blocked = await guardAuth();
  if (blocked) return blocked;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim().slice(0, 80);
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  const passwordProblem = passwordError(password);
  if (passwordProblem) return { error: passwordProblem };
  const supabase = await createServerSupabaseClient();
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });
  if (error) return { error: error.message };
  if (!data.session) {
    return { message: "Check your email to confirm the account, then sign in." };
  }
  redirect(redirectTo(formData));
}

export async function sendMagicLink(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const blocked = await guardAuth();
  if (blocked) return blocked;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  const supabase = await createServerSupabaseClient();
  const origin = await requestOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  });
  if (error) return { error: error.message };
  return { message: "If that email can receive mail, a sign-in link is on its way." };
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }
  const cookieStore = await cookies();
  cookieStore.set(LAST_ACTIVE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });
  redirect("/");
}
