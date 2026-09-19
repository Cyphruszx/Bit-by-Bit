import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  memoryWebhookReceiptStore,
  parseFiskilWebhook,
  receiveFiskilWebhook,
  signFiskilWebhook,
  verifyFiskilWebhookSignature,
  webhookStopsSync,
  webhookTriggersSync,
} from "./webhooks";

const SECRET = Buffer.from("webhook-signing-secret").toString("base64");

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    delivery_attempt: 1,
    publish_time: "2026-09-19T00:00:00.000Z",
    message_id: "msg_1",
    data: {
      event: "banking.transactions.sync.completed",
      end_user_id: "eu_1",
      consent_id: "consent_1",
      account_ids: ["acc_1"],
    },
    ...over,
  });
}

describe("Fiskil webhook signatures", () => {
  it("accepts an HMAC-SHA256 signature over the raw body", () => {
    const body = payload();
    const signature = signFiskilWebhook(body, SECRET);
    assert.equal(verifyFiskilWebhookSignature(body, signature, SECRET), true);
    assert.equal(verifyFiskilWebhookSignature(body, "not-the-signature", SECRET), false);
    assert.equal(verifyFiskilWebhookSignature(`${body} `, signature, SECRET), false);
  });

  it("parses message_id and banking event fields", () => {
    const event = parseFiskilWebhook(JSON.parse(payload()));
    assert.equal(event?.messageId, "msg_1");
    assert.equal(event?.event, "banking.transactions.sync.completed");
    assert.equal(event?.consentId, "consent_1");
    assert.equal(event?.endUserId, "eu_1");
    assert.deepEqual(event?.accountIds, ["acc_1"]);
    assert.equal(webhookTriggersSync(event!.event), true);
    assert.equal(webhookStopsSync("consent.revoked"), true);
  });
});

describe("webhook idempotency", () => {
  it("processes each message_id once", async () => {
    const body = payload();
    const signature = signFiskilWebhook(body, SECRET);
    const receipts = memoryWebhookReceiptStore();
    const first = await receiveFiskilWebhook(body, signature, { secret: SECRET, receipts });
    const second = await receiveFiskilWebhook(body, signature, { secret: SECRET, receipts });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
  });

  it("rejects a missing secret or a bad signature without recording the event", async () => {
    const body = payload();
    const receipts = memoryWebhookReceiptStore();
    const missing = await receiveFiskilWebhook(body, "sig", { secret: null, receipts });
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.status, 503);

    const bad = await receiveFiskilWebhook(body, "nope", { secret: SECRET, receipts });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.status, 401);
    assert.equal(await receipts.get("msg_1"), undefined);
  });
});
