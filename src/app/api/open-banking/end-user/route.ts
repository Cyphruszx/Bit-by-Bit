/**
 * Spec 12 Slice 1: create or link a Fiskil end user for a BitbyBit user_id.
 *
 * Server-only. The response is the mapping — never the Fiskil secret or app token.
 * Slice 2 starts Link from POST /api/open-banking/auth-session after this mapping exists.
 */

import { parseProvisionBody, processEndUserLinkStore, provisionOpenBankingEndUser } from "@/lib/fiskil/end-users";
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

  const result = await provisionOpenBankingEndUser(parseProvisionBody(raw), {
    store: processEndUserLinkStore(),
    cache: processTokenCache(),
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({
    userId: result.link.userId,
    endUserId: result.link.endUserId,
    created: result.link.created,
  });
}
