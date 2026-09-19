/**
 * Spec 12 Slice 3: first-connect / poll fallback.
 *
 * GET is the Vercel cron entry. Hobby allows one cron per day — this deploy
 * uses `0 14 * * *` (14:00 UTC). Spec still allows ≤4h polling on Pro.
 * Webhooks remain the primary sync path. POST with a connection id runs the
 * same upsert keys as the webhook path and returns the durable ledger the
 * signed-in UI can merge. Responses never include Fiskil secrets.
 */

import { ledgerFromSync, processSyncDeps, publicSyncResult, runOpenBankingSyncRequest } from "@/lib/fiskil/sync";
import { parseFeatureToggles } from "@/lib/money-flow/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runOpenBankingSyncRequest({ poll: true }, processSyncDeps());
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
    processSyncDeps(),
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const ledger = result.results.map(ledgerFromSync).find((row) => row);
  return Response.json({
    results: result.results.map(publicSyncResult),
    ...(ledger ? { ledger } : {}),
  });
}
