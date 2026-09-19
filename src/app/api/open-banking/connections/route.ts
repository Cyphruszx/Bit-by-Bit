/**
 * Spec 12 Slice 2: list / complete / revoke / reconnect bank links.
 *
 * Complete records a consent after Link. Revoke and reconnect are stubs —
 * they update our store and can mint a new session, without calling Fiskil
 * revoke. Responses never include the app token or client secret.
 */

import {
  completeOpenBankingConnection,
  listOpenBankingConnections,
  parseCompleteBody,
  parseListQuery,
  parseReconnectBody,
  parseRevokeBody,
  processAuthSessionStore,
  processConnectionStore,
  publicConnectFailure,
  publicStartSession,
  reconnectOpenBankingConnection,
  revokeOpenBankingConnection,
} from "@/lib/fiskil/connections";
import { processEndUserLinkStore } from "@/lib/fiskil/end-users";
import { processTokenCache } from "@/lib/fiskil/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps() {
  return {
    endUsers: processEndUserLinkStore(),
    connections: processConnectionStore(),
    sessions: processAuthSessionStore(),
    cache: processTokenCache(),
  };
}

export async function GET(request: Request) {
  const result = await listOpenBankingConnections(parseListQuery(new URL(request.url)), deps());
  if (!result.ok) {
    return Response.json(publicConnectFailure(result), { status: result.status });
  }
  return Response.json(result);
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const action = typeof raw === "object" && raw && "action" in raw ? String((raw as { action: unknown }).action) : "complete";

  if (action === "revoke") {
    const result = await revokeOpenBankingConnection(parseRevokeBody(raw), deps());
    if (!result.ok) return Response.json(publicConnectFailure(result), { status: result.status });
    return Response.json({
      connection: result.connection,
      connectionCount: result.connectionCount,
      remaining: result.remaining,
    });
  }

  if (action === "reconnect") {
    const result = await reconnectOpenBankingConnection(withDefaultUris(parseReconnectBody(raw), request), deps());
    if (!result.ok) return Response.json(publicConnectFailure(result), { status: result.status });
    return Response.json(publicStartSession(result));
  }

  const result = await completeOpenBankingConnection(parseCompleteBody(raw), deps());
  if (!result.ok) return Response.json(publicConnectFailure(result), { status: result.status });
  return Response.json({
    connection: result.connection,
    connectionCount: result.connectionCount,
    remaining: result.remaining,
  });
}

function withDefaultUris<T extends { redirectUri: string; cancelUri: string }>(input: T, request: Request): T {
  if (input.redirectUri.trim() && input.cancelUri.trim()) return input;
  const origin = new URL(request.url).origin;
  return {
    ...input,
    redirectUri: input.redirectUri.trim() || `${origin}/accounts?open-banking=linked`,
    cancelUri: input.cancelUri.trim() || `${origin}/accounts?open-banking=cancelled`,
  };
}
