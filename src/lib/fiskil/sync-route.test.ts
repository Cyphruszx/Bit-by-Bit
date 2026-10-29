import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET, POST } from "@/app/api/open-banking/sync/route";
import { installTestSession, setSessionVerifierForTests, testSessionHeaders } from "@/lib/auth/request-session";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL } from "./config";
import { processConnectionStore, type BankConnection } from "./connections";
import { SANDBOX_ACCOUNT, SANDBOX_TRANSACTION } from "./sandbox-shapes";

const SECRET = "cron-secret-value";

const previousCron = process.env.CRON_SECRET;
const previousId = process.env.FISKIL_CLIENT_ID;
const previousClientSecret = process.env.FISKIL_CLIENT_SECRET;
const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const previousFetch = globalThis.fetch;
const previousError = console.error;

const DUE: BankConnection = {
  id: "consent_cron",
  userId: "user-cron",
  endUserId: "eu_cron",
  sessionId: "sess_cron",
  consentId: "consent_cron",
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
};

afterEach(() => {
  setSessionVerifierForTests(undefined);
  if (previousCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCron;
  if (previousId === undefined) delete process.env.FISKIL_CLIENT_ID;
  else process.env.FISKIL_CLIENT_ID = previousId;
  if (previousClientSecret === undefined) delete process.env.FISKIL_CLIENT_SECRET;
  else process.env.FISKIL_CLIENT_SECRET = previousClientSecret;
  if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
  globalThis.fetch = previousFetch;
  console.error = previousError;
});

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/open-banking/sync", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

/** Memory stores only, one due connection, and a fetch that counts calls. */
async function armPoll(): Promise<{ fetches: () => number }> {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.FISKIL_CLIENT_ID = "client-id";
  process.env.FISKIL_CLIENT_SECRET = "super-secret-value";
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (url === FISKIL_TOKEN_URL) {
      return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(`${FISKIL_API_BASE}/banking/accounts`)) {
      return new Response(JSON.stringify({ accounts: [SANDBOX_ACCOUNT] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(`${FISKIL_API_BASE}/banking/transactions`)) {
      return new Response(JSON.stringify({ transactions: [SANDBOX_TRANSACTION] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(`${FISKIL_API_BASE}/banking/balances`)) {
      return new Response(JSON.stringify({ balances: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  await processConnectionStore().put(DUE);
  return { fetches: () => calls };
}

describe("GET /api/open-banking/sync cron auth", { concurrency: 1 }, () => {
  it("returns 401 and does no work when Authorization is missing", async () => {
    process.env.CRON_SECRET = SECRET;
    const armed = await armPoll();
    const response = await GET(cronRequest());
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string; polled?: number };
    assert.equal(body.error, "Unauthorized.");
    assert.equal(body.polled, undefined);
    assert.equal(armed.fetches(), 0);
  });

  it("returns 401 and does no work when the bearer secret is wrong", async () => {
    process.env.CRON_SECRET = SECRET;
    const armed = await armPoll();
    const response = await GET(cronRequest("Bearer not-the-secret"));
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "Unauthorized.");
    assert.equal(armed.fetches(), 0);
  });

  it("runs the poll when Authorization is Bearer CRON_SECRET", async () => {
    process.env.CRON_SECRET = SECRET;
    const armed = await armPoll();
    const response = await GET(cronRequest(`Bearer ${SECRET}`));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { polled: number; results: Array<{ ok?: boolean }> };
    assert.equal(body.polled, 1);
    assert.equal(body.results[0]?.ok, true);
    assert.ok(armed.fetches() > 0);
    assert.doesNotMatch(JSON.stringify(body), /super-secret-value/);
    assert.doesNotMatch(JSON.stringify(body), /cron-secret-value/);
  });

  it("fails closed and logs when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const armed = await armPoll();
    const logged: string[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    const response = await GET(cronRequest(`Bearer ${SECRET}`));
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error?: string; polled?: number };
    assert.equal(body.error, "Unauthorized.");
    assert.equal(body.polled, undefined);
    assert.equal(armed.fetches(), 0);
    assert.match(logged.join("\n"), /CRON_SECRET is unset/);
    assert.doesNotMatch(logged.join("\n"), /cron-secret-value/);
  });

  it("does not poll every connection when POST says poll", async () => {
    process.env.CRON_SECRET = SECRET;
    const armed = await armPoll();
    const response = await POST(
      new Request("http://localhost/api/open-banking/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poll: true, featureToggles: { OPEN_BANKING: true } }),
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(armed.fetches(), 0);
  });

  it("still runs a signed-in manual sync without the cron header", async () => {
    process.env.CRON_SECRET = SECRET;
    installTestSession({ userId: "user-cron", email: "cron@example.com" });
    const armed = await armPoll();
    const response = await POST(
      new Request("http://localhost/api/open-banking/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testSessionHeaders("user-cron") },
        body: JSON.stringify({
          userId: "someone-else",
          connectionId: "consent_cron",
          featureToggles: { OPEN_BANKING: false },
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: Array<{ ok?: boolean }> };
    assert.equal(body.results[0]?.ok, true);
    assert.ok(armed.fetches() > 0);
  });
});
