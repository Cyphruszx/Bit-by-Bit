/**
 * Spec 12 Slice 3: Fiskil webhook receiver.
 *
 * Verifies X-Fiskil-Signature, processes each message_id once, and runs the
 * same sync upsert as first-connect / poll. Secrets stay on the server.
 */

import { processConnectionStore } from "@/lib/fiskil/connections";
import { processEndUserLinkStore } from "@/lib/fiskil/end-users";
import { processLedgerDocumentStore } from "@/lib/fiskil/ledger-store";
import { handleOpenBankingWebhookEvent } from "@/lib/fiskil/sync";
import { processTokenCache } from "@/lib/fiskil/token";
import {
  FISKIL_SIGNATURE_HEADER,
  processWebhookReceiptStore,
  receiveFiskilWebhook,
  webhookStopsSync,
  webhookTriggersSync,
} from "@/lib/fiskil/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function syncDeps() {
  return {
    connections: processConnectionStore(),
    endUsers: processEndUserLinkStore(),
    ledgers: processLedgerDocumentStore(),
    receipts: processWebhookReceiptStore(),
    cache: processTokenCache(),
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get(FISKIL_SIGNATURE_HEADER);
  const received = await receiveFiskilWebhook(rawBody, signature, {
    receipts: processWebhookReceiptStore(),
  });
  if (!received.ok) {
    return Response.json({ error: received.error }, { status: received.status });
  }
  if (received.duplicate) {
    return Response.json({ received: true, duplicate: true });
  }

  const event = received.event;
  if (webhookTriggersSync(event.event) || webhookStopsSync(event.event)) {
    const result = await handleOpenBankingWebhookEvent(event, syncDeps());
    if (!result.ok && result.status !== 404) {
      return Response.json({ received: true, error: result.error }, { status: 200 });
    }
  }

  return Response.json({ received: true, duplicate: false });
}
