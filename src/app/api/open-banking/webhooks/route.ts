/**
 * Spec 12 Slice 3: Fiskil webhook receiver.
 *
 * Verifies X-Fiskil-Signature, processes each message_id once, and runs the
 * same sync upsert as first-connect / poll. Secrets stay on the server.
 */

import { logFiskilSupport } from "@/lib/fiskil/log";
import { openBankingRuntimeStores } from "@/lib/fiskil/runtime-stores";
import { handleOpenBankingWebhookEvent, processSyncDeps } from "@/lib/fiskil/sync";
import { processTokenCache } from "@/lib/fiskil/token";
import {
  FISKIL_SIGNATURE_HEADER,
  receiveFiskilWebhook,
  webhookStopsSync,
  webhookTriggersSync,
} from "@/lib/fiskil/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function syncDeps() {
  const stores = openBankingRuntimeStores();
  return {
    ...processSyncDeps(),
    connections: stores.connections,
    endUsers: stores.endUsers,
    ledgers: stores.ledgers,
    receipts: stores.receipts,
    cache: processTokenCache(),
  };
}

export async function POST(request: Request) {
  const stores = openBankingRuntimeStores();
  const rawBody = await request.text();
  const signature = request.headers.get(FISKIL_SIGNATURE_HEADER);
  const received = await receiveFiskilWebhook(rawBody, signature, {
    receipts: stores.receipts,
  });
  if (!received.ok) {
    return Response.json({ error: received.error }, { status: received.status });
  }
  if (received.duplicate) {
    return Response.json({ received: true, duplicate: true });
  }

  const event = received.event;
  logFiskilSupport("open_banking.route.webhook", {
    end_user_id: event.endUserId,
    consent_id: event.consentId,
  }, { action: event.event });
  if (webhookTriggersSync(event.event) || webhookStopsSync(event.event)) {
    const result = await handleOpenBankingWebhookEvent(event, syncDeps());
    if (!result.ok && result.status !== 404) {
      return Response.json({ received: true, error: result.error }, { status: 200 });
    }
  }

  return Response.json({ received: true, duplicate: false });
}
