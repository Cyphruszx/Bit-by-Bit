/**
 * Spec 12 Slice 3: first-connect / poll fallback (≤4h).
 *
 * GET is the Vercel cron entry. POST with a connection id runs the same upsert
 * keys as the webhook path. Responses never include Fiskil secrets.
 */

import { processConnectionStore } from "@/lib/fiskil/connections";
import { processEndUserLinkStore } from "@/lib/fiskil/end-users";
import { processLedgerDocumentStore } from "@/lib/fiskil/ledger-store";
import { runOpenBankingSyncRequest } from "@/lib/fiskil/sync";
import { processTokenCache } from "@/lib/fiskil/token";
import { parseFeatureToggles } from "@/lib/money-flow/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps() {
  return {
    connections: processConnectionStore(),
    endUsers: processEndUserLinkStore(),
    ledgers: processLedgerDocumentStore(),
    cache: processTokenCache(),
  };
}

export async function GET() {
  const result = await runOpenBankingSyncRequest({ poll: true }, deps());
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({
    polled: result.results.length,
    results: result.results.map(publicSyncResult),
  });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = await runOpenBankingSyncRequest(
    {
      userId: typeof body.userId === "string" ? body.userId : "",
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      featureToggles: parseFeatureToggles(body.featureToggles),
      poll: body.poll === true,
    },
    deps(),
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ results: result.results.map(publicSyncResult) });
}

function publicSyncResult(result: { ok: boolean; connectionId?: string; firstSync?: boolean; skipped?: boolean; reconnect?: boolean; error?: string }) {
  if (!result.ok) {
    return {
      ok: false,
      ...(result.connectionId ? { connectionId: result.connectionId } : {}),
      ...(result.reconnect ? { reconnect: true } : {}),
      error: result.error,
    };
  }
  return {
    ok: true,
    connectionId: result.connectionId,
    firstSync: result.firstSync === true,
    ...(result.skipped ? { skipped: true } : {}),
    ...(result.reconnect ? { reconnect: true } : {}),
  };
}
