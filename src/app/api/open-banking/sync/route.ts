/**
 * Spec 12 Slice 3: first-connect / poll fallback.
 *
 * GET is the Vercel cron entry. Hobby allows one cron per day — this deploy
 * uses `0 14 * * *` (14:00 UTC). Spec still allows ≤4h polling on Pro.
 * Webhooks remain the primary sync path. Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` when that env var is set; GET runs
 * only then. POST is the signed-in manual sync (Connect bank → Sync now):
 * the browser sends that user's id, and the job runs only when the connection
 * belongs to them. A `poll` flag on POST does not run the global poll —
 * that job is the cron GET only. Responses never include Fiskil secrets.
 */

import { timingSafeEqual } from "node:crypto";
import { logFiskilSupport } from "@/lib/fiskil/log";
import { ledgerFromSync, processSyncDeps, publicSyncResult, runOpenBankingSyncRequest } from "@/lib/fiskil/sync";
import { parseFeatureToggles } from "@/lib/money-flow/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerMatches(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/** Cron gate. Returns a response when GET must not run, otherwise null. */
function rejectUnlessCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is unset; refusing GET /api/open-banking/sync.");
    return Response.json({ error: "Unauthorized." }, { status: 500 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = rejectUnlessCron(request);
  if (denied) return denied;
  const result = await runOpenBankingSyncRequest({ poll: true }, processSyncDeps());
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  logFiskilSupport("open_banking.route.sync", {}, { action: "poll" });
  return Response.json({
    polled: result.results.length,
    results: result.results.map(publicSyncResult),
  });
}

/**
 * Manual sync for a signed-in user. Not gated by CRON_SECRET — the UI only
 * calls this with the session user id, and the sync refuses a connection
 * that belongs to someone else. `poll: true` is ignored so this route cannot
 * stand in for the cron.
 */
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
    },
    processSyncDeps(),
  );
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  logFiskilSupport("open_banking.route.sync", {}, { action: "manual" });
  const ledger = result.results.map(ledgerFromSync).find((row) => row);
  return Response.json({
    results: result.results.map(publicSyncResult),
    ...(ledger ? { ledger } : {}),
  });
}
