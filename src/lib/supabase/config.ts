export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const LAST_ACTIVE_COOKIE = "bitbybit.last-active";

export function getSupabaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

export function getSupabasePublishableKey(env: Record<string, string | undefined> = process.env): string {
  return (
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

export function isSupabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const url = getSupabaseUrl(env);
  const key = getSupabasePublishableKey(env);
  if (!url || !key) return false;
  return !looksLikeServiceRoleKey(key);
}

export function looksLikeServiceRoleKey(key: string): boolean {
  if (key.includes("service_role")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const json = decodeBase64Url(payload);
    return json.includes("service_role");
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") return atob(normalized);
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function supabaseCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function supabaseOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const url = getSupabaseUrl(env);
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
