/**
 * Whether this copy of BitbyBit has somewhere to sign in to.
 *
 * The app works entirely in the browser and needs no account. Signing in adds one thing: a
 * backup of the ledger that survives a cleared browser and follows the person to another
 * device. With nothing configured there is no sign-in, no network, and nothing about the
 * app behaves differently — which is also how every test and the Vercel preview run.
 */

export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

/**
 * The publishable key is meant to be in the browser: it can do nothing on its own, because
 * every row is guarded by row-level security keyed on the signed-in person. The service
 * role key bypasses that entirely and must never appear here or anywhere client-side.
 *
 * Next.js only puts NEXT_PUBLIC_* into the browser bundle on a direct static read —
 * `process.env.NEXT_PUBLIC_SUPABASE_URL`. Passing the whole `process.env` object and
 * indexing a parameter leaves those blank in the client, while the server still sees
 * them at runtime. That is why the sign-in form can render and then say signing in is
 * not set up. Tests pass a fake env so they do not depend on the process.
 */
function bundledPublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function supabaseConfig(
  env: Record<string, string | undefined> = bundledPublicEnv(),
): SupabaseConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  if (!looksLikeUrl(url)) return null;
  return { url, publishableKey };
}

export function canSignIn(env?: Record<string, string | undefined>): boolean {
  return supabaseConfig(env) !== null;
}

/** A half-filled .env should read as "not configured", not as a crash on first render. */
function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}
