"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * The one Supabase client, made on first use and kept.
 *
 * The browser holds the session. Open Banking calls send its access token, and the
 * server checks that token with Supabase. Row-level security still guards ledger rows.
 * A stolen publishable key still reaches nobody's ledger.
 */
let held: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (held) return held;
  const config = supabaseConfig();
  if (!config) return null;

  held = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return held;
}
