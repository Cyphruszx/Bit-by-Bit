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
 */
export function supabaseConfig(
  env: Record<string, string | undefined> = process.env,
): SupabaseConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  if (!looksLikeUrl(url)) return null;
  return { url, publishableKey };
}

export function canSignIn(env: Record<string, string | undefined> = process.env): boolean {
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
