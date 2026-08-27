import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl, isSupabaseConfigured, supabaseCookieOptions } from "@/lib/supabase/config";

export function createBrowserSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
  });
}
