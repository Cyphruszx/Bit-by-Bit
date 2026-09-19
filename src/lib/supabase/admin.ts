/**
 * Server-only Supabase admin (service role).
 *
 * Open Banking webhooks, first-connect sync, and poll have no user JWT, so they
 * cannot pass `public.ledgers` RLS. The service role bypasses RLS and must never
 * appear in a "use client" module or as NEXT_PUBLIC_*.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminConfig = {
  url: string;
  serviceRoleKey: string;
};

export type SupabaseAdminEnv = Record<string, string | undefined>;

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Project URL + service role. The publishable key is not enough: RLS would
 * block every job that is not the signed-in browser.
 *
 * NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is ignored on purpose.
 */
export function supabaseAdminConfig(env: SupabaseAdminEnv = process.env): SupabaseAdminConfig | null {
  const url = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  if (!looksLikeUrl(url)) return null;
  return { url, serviceRoleKey };
}

export function canUseSupabaseAdmin(env: SupabaseAdminEnv = process.env): boolean {
  return supabaseAdminConfig(env) !== null;
}

let held: SupabaseClient | null = null;
let heldStamp = "";

export function supabaseAdmin(env: SupabaseAdminEnv = process.env): SupabaseClient | null {
  const config = supabaseAdminConfig(env);
  if (!config) return null;
  const stamp = `${config.url}\0${config.serviceRoleKey}`;
  if (held && heldStamp === stamp) return held;
  held = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  heldStamp = stamp;
  return held;
}
