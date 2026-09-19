import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST } from "@/app/api/open-banking/webhooks/route";
import { processConnectionStore } from "./connections";
import { processEndUserLinkStore } from "./end-users";
import { processLedgerDocumentStore } from "./ledger-store";
import { processWebhookReceiptStore, signFiskilWebhook } from "./webhooks";

const previousSecret = process.env.FISKIL_WEBHOOK_SECRET;
const previousId = process.env.FISKIL_CLIENT_ID;
const previousClientSecret = process.env.FISKIL_CLIENT_SECRET;
const previousFetch = globalThis.fetch;
const SECRET = Buffer.from("route-webhook-secret").toString("base64");

afterEach(() => {
  if (previousSecret === undefined) delete process.env.FISKIL_WEBHOOK_SECRET;
  else process.env.FISKIL_WEBHOOK_SECRET = previousSecret;
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousClientSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousClientSecret;
  globalThis.fetch = previousFetch;
});

function signedRequest(body: string, signature?: string) {
  return new Request("http://localhost/api/open-banking/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fiskil-Signature": signature ?? signFiskilWebhook(body, SECRET),
    },
    body,
  });
}

describe("Open Banking webhook route", () => {
  it("rejects a bad signature", async () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET;
    const body = JSON.stringify({
      message_id: "msg_bad",
      data: { event: "banking.transactions.sync.completed", consent_id: "c1", end_user_id: "eu" },
    });
    const response = await POST(signedRequest(body, "aaaa"));
    assert.equal(response.status, 401);
  });

  it("is idempotent on message_id and never echoes secrets", async () => {
    process.env.FISKIL_WEBHOOK_SECRET = SECRET;
    process.env.FISKIL_CLIENT_ID = "client-id";
    process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
    globalThis.fetch = (async () => new Response(JSON.stringify({ token: "tok" }), { status: 200 })) as typeof fetch;

    await processEndUserLinkStore().put({ userId: "user-wh", endUserId: "eu_wh", email: "sam@example.com" });
    await processConnectionStore().put({
      id: "consent_wh",
      userId: "user-wh",
      endUserId: "eu_wh",
      sessionId: "sess_wh",
      consentId: "consent_wh",
      status: "active",
      createdAt: "2026-09-19T00:00:00.000Z",
    });

    const body = JSON.stringify({
      message_id: "msg_route_1",
      data: {
        event: "banking.transactions.sync.completed",
        consent_id: "consent_wh",
        end_user_id: "eu_wh",
      },
    });
    const first = await POST(signedRequest(body));
    const second = await POST(signedRequest(body));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstBody = (await first.json()) as { duplicate?: boolean };
    const secondBody = (await second.json()) as { duplicate?: boolean };
    assert.equal(firstBody.duplicate, false);
    assert.equal(secondBody.duplicate, true);
    assert.doesNotMatch(JSON.stringify(secondBody), /super-secret-value/);
    assert.ok(await processWebhookReceiptStore().get("msg_route_1"));
    const ledger = await processLedgerDocumentStore().get("user-wh");
    assert.ok(ledger);
  });
});
