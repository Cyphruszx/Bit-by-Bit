import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowConnectBank,
  cancelledLinkMessage,
  connectBlockedByCap,
  connectCapCopy,
  runConnectBankFlow,
  type ConnectBankDeps,
} from "./connect-flow";
import { CONNECTION_CAP_CODE, CONNECTION_CAP_COPY, MAX_BANK_CONNECTIONS } from "./limits";

const BASE = {
  userId: "user-1",
  email: "sam@example.com",
  redirectUri: "https://app.example/accounts?open-banking=linked",
  cancelUri: "https://app.example/accounts?open-banking=cancelled",
};

function deps(overrides: Partial<ConnectBankDeps> = {}): ConnectBankDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensureEndUser() {
      calls.push("ensure");
      return { ok: true, sessionId: "", connectionCount: 0, remaining: 5 };
    },
    async startSession() {
      calls.push("session");
      return { ok: true, sessionId: "sess_1", connectionCount: 0, remaining: 5 };
    },
    async launchLink(sessionId) {
      calls.push(`link:${sessionId}`);
      return { consentId: "consent_1" };
    },
    async completeConnection() {
      calls.push("complete");
      return { ok: true, id: "consent_1", connectionCount: 1, remaining: 4 };
    },
    ...overrides,
  };
}

describe("OPEN_BANKING Connect gate (client)", () => {
  it("hides Connect unless the bundle toggle is on", () => {
    assert.equal(canShowConnectBank(false), false);
    assert.equal(canShowConnectBank(true), true);
  });

  it("does not call session or Link when the gate is off", async () => {
    const wired = deps();
    const result = await runConnectBankFlow({ ...BASE, featureToggles: { OPEN_BANKING: false } }, wired);
    assert.equal(result.ok, false);
    assert.deepEqual(wired.calls, []);
  });
});

describe("5-connection cap (client)", () => {
  it("blocks a 6th connect with the locked copy", () => {
    assert.equal(connectBlockedByCap(5), true);
    assert.equal(connectBlockedByCap(4), false);
    assert.equal(MAX_BANK_CONNECTIONS, 5);
    assert.match(connectCapCopy(5), /Disconnect one to add another/);
    assert.equal(connectCapCopy(5).includes(CONNECTION_CAP_COPY), true);
  });

  it("stops the flow at session start when the server returns the cap", async () => {
    const wired = deps({
      async startSession() {
        return {
          ok: false,
          error: connectCapCopy(5),
          code: CONNECTION_CAP_CODE,
          status: 409,
          connectionCount: 5,
        };
      },
    });
    const result = await runConnectBankFlow({ ...BASE, featureToggles: { OPEN_BANKING: true } }, wired);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, CONNECTION_CAP_CODE);
    assert.deepEqual(wired.calls, ["ensure"]);
  });
});

describe("Connect flow: end-user → session → Link", () => {
  it("runs ensure, then session, then Link, then complete", async () => {
    const wired = deps();
    const result = await runConnectBankFlow({ ...BASE, featureToggles: { OPEN_BANKING: true } }, wired);
    assert.equal(result.ok, true);
    assert.deepEqual(wired.calls, ["ensure", "session", "link:sess_1", "complete"]);
    if (!result.ok) return;
    assert.equal(result.id, "consent_1");
  });

  it("treats a cancelled Link as a cancelled connect, not a secret leak", async () => {
    const wired = deps({
      async launchLink() {
        const err = new Error("closed");
        (err as Error & { code: string }).code = "LINK_USER_CANCELLED";
        throw err;
      },
    });
    const result = await runConnectBankFlow({ ...BASE, featureToggles: { OPEN_BANKING: true } }, wired);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.cancelled, true);
    assert.equal(cancelledLinkMessage({ code: "LINK_USER_CANCELLED" }), "Bank connection was cancelled.");
    assert.doesNotMatch(result.error, /secret|token|FISKIL/i);
  });
});
