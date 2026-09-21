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
  parseLeaveBody,
  parseProvisionBody,
  provisionOpenBankingEndUser,
} from "@/lib/fiskil/end-users";
import { logFiskilSupport } from "@/lib/fiskil/log";
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

  const result = await provisionOpenBankingEndUser(parseProvisionBody(raw), {
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
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const stores = openBankingRuntimeStores();
  const result = await leaveOpenBankingProduct(
    { userId: parseLeaveBody(raw).userId, reason: "account_delete" },
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
