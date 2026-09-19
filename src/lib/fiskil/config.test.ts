import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FISKIL_SCOPES,
  FISKIL_TOKEN_TTL_SECONDS,
  fiskilCredentials,
  fiskilWebhookSecret,
  isFiskilConfigured,
  publicFiskilEnvNames,
} from "./config";

describe("Fiskil server credentials (Spec 12.2)", () => {
  const good = {
    FISKIL_CLIENT_ID: "client-id",
    FISKIL_CLIENT_SECRET: "client-secret",
  };

  it("reads server env only", () => {
    assert.deepEqual(fiskilCredentials(good), { clientId: "client-id", clientSecret: "client-secret" });
    assert.equal(isFiskilConfigured(good), true);
  });

  it("treats a half-filled env as not configured", () => {
    assert.equal(fiskilCredentials({}), null);
    assert.equal(isFiskilConfigured({ FISKIL_CLIENT_ID: "client-id" }), false);
    assert.equal(isFiskilConfigured({ FISKIL_CLIENT_SECRET: "client-secret" }), false);
    assert.equal(isFiskilConfigured({ ...good, FISKIL_CLIENT_SECRET: "  " }), false);
  });

  it("does not treat NEXT_PUBLIC_ Fiskil keys as credentials", () => {
    assert.equal(
      fiskilCredentials({
        NEXT_PUBLIC_FISKIL_CLIENT_ID: "leaked-id",
        NEXT_PUBLIC_FISKIL_CLIENT_SECRET: "leaked-secret",
      }),
      null,
    );
    assert.deepEqual(
      publicFiskilEnvNames({
        NEXT_PUBLIC_FISKIL_CLIENT_SECRET: "leaked-secret",
        FISKIL_CLIENT_ID: "ok",
      }),
      ["NEXT_PUBLIC_FISKIL_CLIENT_SECRET"],
    );
  });

  it("asks for the scopes Spec 12 locked", () => {
    assert.deepEqual([...FISKIL_SCOPES], ["api:user.read", "api:user.write", "api:banking"]);
    assert.equal(FISKIL_TOKEN_TTL_SECONDS, 900);
  });

  it("reads the webhook secret from server env only", () => {
    assert.equal(fiskilWebhookSecret({ FISKIL_WEBHOOK_SECRET: "whsec" }), "whsec");
    assert.equal(fiskilWebhookSecret({ NEXT_PUBLIC_FISKIL_WEBHOOK_SECRET: "leaked" }), null);
  });
});
