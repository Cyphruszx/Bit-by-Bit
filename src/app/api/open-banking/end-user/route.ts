/**
 * Spec 12 Slice 1: create or link a Fiskil end user for a BitbyBit user_id.
 *
 * DELETE is the leave-product / account-delete hook: it deletes the Fiskil
 * end user and the local mapping. Sign-out does not call this. Last bank
 * disconnect also runs the same cleanup from the connections revoke path.
 *
 * Server-only. The response is the mapping — never the Fiskil secret or app token.
 * Slice 2 starts Link from POST /api/open-banking/auth-session after this mapping exists.
 */

import {
  leaveOpenBankingProduct,
  parseProvisionBody,
  provisionOpenBankingEndUser,
} from "@/lib/fiskil/end-users";
import { logFiskilSupport } from "@/lib/fiskil/log";
import { openBankingRuntimeStores } from "@/lib/fiskil/runtime-stores";
import { processTokenCache } from "@/lib/fiskil/token";
import { requireOpenBankingActor } from "@/lib/open-banking/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await requireOpenBankingActor(request);
  if (!actor.ok) return actor.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = parseProvisionBody(raw);
  const result = await provisionOpenBankingEndUser({
    ...parsed,
    userId: actor.actor.userId,
    email: actor.actor.email,
    featureToggles: actor.actor.featureToggles,
  }, {
    store: openBankingRuntimeStores().endUsers,
    cache: processTokenCache(),
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  logFiskilSupport("open_banking.route.end_user", { end_user_id: result.link.endUserId }, {
    action: "provision",
  });
  return Response.json({
    userId: result.link.userId,
    endUserId: result.link.endUserId,
    created: result.link.created,
  });
}

export async function DELETE(request: Request) {
  const actor = await requireOpenBankingActor(request, { requireBundle: false });
  if (!actor.ok) return actor.response;

  const stores = openBankingRuntimeStores();
  const result = await leaveOpenBankingProduct(
    { userId: actor.actor.userId, reason: "account_delete" },
    {
      endUsers: stores.endUsers,
      connections: stores.connections,
      cache: processTokenCache(),
    },
  );

  if (!result.ok) {
    logFiskilSupport("open_banking.route.end_user", {
      end_user_id: result.endUserId,
      error_id: result.errorId,
    }, { status: result.status, action: "account_delete" });
    return Response.json(
      { error: result.error, ...(result.errorId ? { errorId: result.errorId } : {}) },
      { status: result.status },
    );
  }

  logFiskilSupport("open_banking.route.end_user", { end_user_id: result.endUserId }, {
    action: "account_delete",
  });
  return Response.json({
    deleted: result.deleted,
    ...(result.skipped ? { skipped: true } : {}),
    ...(result.alreadyGone ? { alreadyGone: true } : {}),
  });
}
