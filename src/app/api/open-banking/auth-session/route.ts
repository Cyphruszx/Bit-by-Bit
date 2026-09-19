/**
 * Spec 12 Slice 2: start a Fiskil auth session for Link.
 *
 * Ensures the end user, enforces the 5-connection cap, stores the session
 * server-side, and returns only sessionId (never the app token or secret).
 */

import {
  parseStartSessionBody,
  publicConnectFailure,
  publicStartSession,
  startOpenBankingLinkSession,
} from "@/lib/fiskil/connections";
import { openBankingRuntimeStores } from "@/lib/fiskil/runtime-stores";
import { processTokenCache } from "@/lib/fiskil/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const stores = openBankingRuntimeStores();
  const result = await startOpenBankingLinkSession(withDefaultUris(parseStartSessionBody(raw), request), {
    endUsers: stores.endUsers,
    connections: stores.connections,
    sessions: stores.sessions,
    cache: processTokenCache(),
  });

  if (!result.ok) {
    return Response.json(publicConnectFailure(result), { status: result.status });
  }

  return Response.json(publicStartSession(result));
}

function withDefaultUris<T extends { redirectUri: string; cancelUri: string }>(input: T, request: Request): T {
  if (input.redirectUri.trim() && input.cancelUri.trim()) return input;
  const origin = requestOrigin(request);
  return {
    ...input,
    redirectUri: input.redirectUri.trim() || `${origin}/accounts?open-banking=linked`,
    cancelUri: input.cancelUri.trim() || `${origin}/accounts?open-banking=cancelled`,
  };
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${forwarded ?? url.protocol.replace(":", "")}://${host}`;
  return url.origin;
}
