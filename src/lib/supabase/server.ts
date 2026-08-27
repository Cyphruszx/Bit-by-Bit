import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublishableKey, getSupabaseUrl, isSupabaseConfigured, supabaseCookieOptions } from "@/lib/supabase/config";

export async function createServerSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies; src/proxy.ts refreshes the session.
        }
      },
    },
  });
}

export async function getAuthUser() {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const sub = data.claims.sub;
    const email = typeof data.claims.email === "string" ? data.claims.email : null;
    if (typeof sub !== "string" || !sub) return null;
    return { id: sub, email };
  } catch {
    return null;
  }
}
