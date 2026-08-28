import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  IDLE_TIMEOUT_MS,
  isSupabaseConfigured,
  LAST_ACTIVE_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  supabaseCookieOptions,
  supabaseOrigin,
} from "@/lib/supabase/config";
import { buildCsp } from "@/lib/security/csp";

function applySecurityHeaders(response: NextResponse, request: NextRequest, nonce: string) {
  const csp = buildCsp(nonce, supabaseOrigin() ?? undefined, process.env.NODE_ENV === "development");
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

function nextWithCsp(request: NextRequest, requestHeaders: Headers, nonce: string) {
  const csp = buildCsp(nonce, supabaseOrigin() ?? undefined, process.env.NODE_ENV === "development");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  applySecurityHeaders(response, request, nonce);
  return response;
}

export async function updateSession(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const requestHeaders = new Headers(request.headers);
  let supabaseResponse = nextWithCsp(request, requestHeaders, nonce);

  if (!isSupabaseConfigured()) {
    return supabaseResponse;
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = nextWithCsp(request, requestHeaders, nonce);
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        if (cacheHeaders) {
          for (const [key, value] of Object.entries(cacheHeaders)) {
            supabaseResponse.headers.set(key, value);
          }
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (signedIn) {
    const lastActiveRaw = request.cookies.get(LAST_ACTIVE_COOKIE)?.value;
    const lastActive = lastActiveRaw ? Number(lastActiveRaw) : NaN;
    if (Number.isFinite(lastActive) && Date.now() - lastActive > IDLE_TIMEOUT_MS) {
      await supabase.auth.signOut();
      supabaseResponse.cookies.set(LAST_ACTIVE_COOKIE, "", { path: "/", maxAge: 0 });
    } else {
      supabaseResponse.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }
  }

  return supabaseResponse;
}
