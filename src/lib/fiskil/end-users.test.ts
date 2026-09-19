import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import {
  ensureFiskilEndUser,
  endUserIdFromCreate,
  endUserIdFromList,
  memoryEndUserLinkStore,
  parseProvisionBody,
  provisionOpenBankingEndUser,
} from "./end-users";
import { memoryTokenCache } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };

type MockCall = { url: string; method: string; body?: unknown; authorization?: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFiskil(handlers: {
  token?: () => Response;
  list?: (email: string) => Response;
  create?: (body: Record<string, string>) => Response;
}): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, authorization });

    if (url === FISKIL_TOKEN_URL) {
      return (handlers.token ?? (() => jsonResponse({ token: "tok_app", expires_in: 900 })))();
    }
    if (url.startsWith(`${FISKIL_API_BASE}/end-users`) && method === "GET") {
      const email = new URL(url).searchParams.get("email") ?? "";
      return (handlers.list ?? (() => jsonResponse([])))(email);
    }
    if (url === `${FISKIL_API_BASE}/end-users` && method === "POST") {
      return (handlers.create ?? (() => jsonResponse({ end_user_id: "eu_new" })))(body ?? {});
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

function deps(handlers: Parameters<typeof mockFiskil>[0] = {}) {
  const mocked = mockFiskil(handlers);
  return {
    ...mocked,
    ensure: {
      credentials: CREDENTIALS,
      store: memoryEndUserLinkStore(),
      cache: memoryTokenCache(),
      fetchImpl: mocked.fetchImpl,
    },
  };
}

describe("Fiskil end-user create/link 1:1 with user_id", () => {
  it("creates a Fiskil end user and stores the BitbyBit mapping", async () => {
    const { ensure, calls } = deps({
      list: () => jsonResponse([]),
      create: (body) => {
        assert.equal(body.email, "sam@example.com");
        assert.equal(body.name, "Sam");
        return jsonResponse({ end_user_id: "eu_created" });
      },
    });

    const link = await ensureFiskilEndUser(
      { userId: "user-1", email: "sam@example.com", name: "Sam" },
      ensure,
    );
    assert.deepEqual(link, {
      userId: "user-1",
      endUserId: "eu_created",
      email: "sam@example.com",
      created: true,
    });
    assert.equal(
      calls.some((call) => call.method === "POST" && call.url === `${FISKIL_API_BASE}/end-users`),
      true,
    );
    assert.equal(
      calls.every((call) => !JSON.stringify(call.body ?? {}).includes("super-secret-value") || call.url === FISKIL_TOKEN_URL),
      true,
    );
    const dataCalls = calls.filter((call) => call.url.includes("/end-users"));
    assert.ok(dataCalls.every((call) => call.authorization === "Bearer tok_app"));
  });

  it("links an existing Fiskil end user found by email without creating another", async () => {
    const { ensure, calls } = deps({
      list: () => jsonResponse([{ id: "eu_existing", email: "sam@example.com" }]),
      create: () => {
        throw new Error("must not create");
      },
    });

    const link = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
    assert.equal(link.endUserId, "eu_existing");
    assert.equal(link.created, false);
    assert.equal(
      calls.some((call) => call.method === "POST" && call.url === `${FISKIL_API_BASE}/end-users`),
      false,
    );
  });

  it("returns the stored mapping on a second call for the same user_id", async () => {
    const { ensure, calls } = deps({
      list: () => jsonResponse([]),
      create: () => jsonResponse({ end_user_id: "eu_once" }),
    });

    const first = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
    const before = calls.length;
    const second = await ensureFiskilEndUser({ userId: "user-1", email: "other@example.com" }, ensure);
    assert.equal(first.endUserId, "eu_once");
    assert.equal(second.endUserId, "eu_once");
    assert.equal(second.created, false);
    assert.equal(calls.length, before);
  });

  it("treats create-already-exists as a link", async () => {
    const { ensure } = deps({
      list: (() => {
        let asks = 0;
        return () => {
          asks += 1;
          return asks === 1 ? jsonResponse([]) : jsonResponse([{ id: "eu_race", email: "sam@example.com" }]);
        };
      })(),
      create: () => jsonResponse({ name: "end_user_already_exists" }, 400),
    });

    const link = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
    assert.equal(link.endUserId, "eu_race");
    assert.equal(link.created, false);
  });

  it("reads both list envelope shapes", () => {
    assert.equal(endUserIdFromList([{ id: "eu_a", email: "a@x.com" }], "a@x.com"), "eu_a");
    assert.equal(
      endUserIdFromList({ end_users: [{ end_user_id: "eu_b", email: "b@x.com" }] }, "b@x.com"),
      "eu_b",
    );
    assert.equal(endUserIdFromCreate({ end_user_id: "eu_c" }), "eu_c");
  });
});

describe("Open Banking provision gate", () => {
  it("refuses create/link without the OPEN_BANKING bundle toggle", async () => {
    const { ensure } = deps();
    const refused = await provisionOpenBankingEndUser(
      { userId: "user-1", email: "sam@example.com" },
      ensure,
    );
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.status, 403);
  });

  it("refuses when Fiskil env is missing", async () => {
    const result = await provisionOpenBankingEndUser(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: true } },
      { store: memoryEndUserLinkStore(), env: {} },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 503);
  });

  it("creates when the bundle toggle is on and credentials are present", async () => {
    const { ensure } = deps({
      list: () => jsonResponse([]),
      create: () => jsonResponse({ end_user_id: "eu_gated" }),
    });
    const result = await provisionOpenBankingEndUser(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: true } },
      ensure,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.link.endUserId, "eu_gated");
    assert.equal(result.link.created, true);
  });

  it("parses the route body without accepting public Fiskil secrets", () => {
    const parsed = parseProvisionBody({
      userId: "user-1",
      email: "sam@example.com",
      featureToggles: { OPEN_BANKING: true },
      FISKIL_CLIENT_SECRET: "nope",
    });
    assert.deepEqual(parsed, {
      userId: "user-1",
      email: "sam@example.com",
      featureToggles: { OPEN_BANKING: true },
    });
  });
});
