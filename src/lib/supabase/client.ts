"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * The one Supabase client, made on first use and kept.
 *
 * Everything in BitbyBit renders in the browser and nothing is fetched on the server, so
 * the browser client is the whole story: it holds the session, refreshes it, and sends it
 * with each request. What protects the data is row-level security in the database, not
 * anything this file does — a stolen publishable key still reaches nobody's ledger.
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
      // The session belongs in this browser and nowhere else; there is no server route
      // that needs to read it.
      detectSessionInUrl: false,
    },
  });
  return held;
}
