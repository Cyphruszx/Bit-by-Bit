/**
 * Who is calling an Open Banking route.
 *
 * The browser keeps the Supabase session and sends it as
 * `Authorization: Bearer <access_token>`, or as the `sb-*-auth-token` cookie
 * `@supabase/ssr` writes. This module reads that token and checks it with
 * `auth.getUser`, which asks Supabase to verify the signature. A userId in
 * the JSON body or query string is never consulted.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

export type SessionUser = {
  userId: string;
  email: string;
};

type AccessTokenVerifier = (accessToken: string) => Promise<SessionUser | null>;

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

let verifyAccessToken: AccessTokenVerifier = verifyWithSupabase;

/** Tests substitute a verifier so routes can run without a live Supabase project. */
export function setSessionVerifierForTests(next: AccessTokenVerifier | undefined): void {
  verifyAccessToken = next ?? verifyWithSupabase;
}

export function testSessionToken(userId: string): string {
  return `test-session:${userId}`;
}

export function testSessionHeaders(userId: string): Record<string, string> {
  return { Authorization: `Bearer ${testSessionToken(userId)}` };
}

export function installTestSession(user: SessionUser | null): void {
  setSessionVerifierForTests(async (token) => {
    if (!user) return null;
    if (token !== testSessionToken(user.userId)) return null;
    return user;
  });
}

export async function sessionUserFromRequest(request: Request): Promise<SessionUser | null> {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) return null;
  return verifyAccessToken(accessToken);
}

export function accessTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    return match?.[1] ?? null;
  }
  return accessTokenFromCookieHeader(request.headers.get("cookie"));
}

export function accessTokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const cookies = parseCookieHeader(header);
  const bases = new Set<string>();
  for (const name of cookies.keys()) {
    if (!AUTH_COOKIE.test(name)) continue;
    bases.add(name.replace(/\.\d+$/, ""));
  }
  for (const base of bases) {
    const whole = cookies.get(base);
    const raw = whole ?? joinCookieChunks(base, cookies);
    const token = accessTokenFromCookieValue(raw);
    if (token) return token;
  }
  return null;
}

export function accessTokenFromCookieValue(raw: string | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeSupabaseCookie(raw);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const token = (parsed as { access_token?: unknown }).access_token;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

async function verifyWithSupabase(accessToken: string): Promise<SessionUser | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user?.id) return null;
  return { userId: data.user.id, email: data.user.email ?? "" };
}

function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const piece of header.split(";")) {
    const index = piece.indexOf("=");
    if (index === -1) continue;
    const name = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (!name) continue;
    cookies.set(name, decodeCookieValue(value));
  }
  return cookies;
}

function joinCookieChunks(base: string, cookies: Map<string, string>): string | undefined {
  const parts: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = cookies.get(`${base}.${index}`);
    if (chunk === undefined) break;
    parts.push(chunk);
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeSupabaseCookie(value: string): string | null {
  if (!value.startsWith("base64-")) return value;
  try {
    const decoded = Buffer.from(value.slice("base64-".length), "base64url").toString("utf8");
    JSON.parse(decoded);
    return decoded;
  } catch {
    return null;
  }
}
