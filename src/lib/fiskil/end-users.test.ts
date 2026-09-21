import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import {
  deleteFiskilEndUser,
  ensureFiskilEndUser,
  endUserIdFromCreate,
  endUserIdFromCreateError,
  endUserIdFromList,
  isFiskilEndUserAlreadyExists,
  isFiskilEndUserNotFound,
  leaveOpenBankingProduct,
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
  remove?: (id: string) => Response;
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
    if (url.startsWith(`${FISKIL_API_BASE}/end-users/`) && method === "DELETE") {
      const id = url.slice(`${FISKIL_API_BASE}/end-users/`.length);
      return (handlers.remove ?? (() => new Response(null, { status: 204 })))(id);
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
      sleep: async () => {},
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

  it("creates after GET list returns 400 end_user_not_found", async () => {
    const { ensure, calls } = deps({
      list: () =>
        jsonResponse(
          {
            name: "end_user_not_found",
            message: "end user for clientID : client-id not found",
          },
          400,
        ),
      create: (body) => {
        assert.equal(body.email, "sam@example.com");
        return jsonResponse({ end_user_id: "eu_created" });
      },
    });

    const link = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
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
  });

  it("treats create-already-exists as a link when email lookup stays not-found", async () => {
    const { ensure, calls } = deps({
      list: (email) => {
        if (email) {
          return jsonResponse(
            {
              name: "end_user_not_found",
              message: "end user for clientID : client-id not found",
            },
            400,
          );
        }
        return jsonResponse({ end_users: [{ id: "eu_race", email: "sam@example.com" }] });
      },
      create: () =>
        jsonResponse(
          { name: "end_user_already_exists", message: "user with that email already exists" },
          400,
        ),
    });

    const link = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
    assert.equal(link.endUserId, "eu_race");
    assert.equal(link.created, false);
    assert.equal(
      calls.some((call) => call.method === "GET" && call.url === `${FISKIL_API_BASE}/end-users`),
      true,
    );
  });

  it("links from create-already-exists when the 400 body includes end_user_id", async () => {
    const { ensure } = deps({
      list: () =>
        jsonResponse(
          { name: "end_user_not_found", message: "end user for clientID : client-id not found" },
          400,
        ),
      create: () =>
        jsonResponse({ name: "end_user_already_exists", end_user_id: "eu_from_body" }, 400),
    });

    const link = await ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure);
    assert.equal(link.endUserId, "eu_from_body");
    assert.equal(link.created, false);
  });

  it("still fails lookup on auth, server, and other 400 errors", async () => {
    for (const [status, body] of [
      [401, { name: "unauthorized" }],
      [403, { name: "insufficient_scopes" }],
      [500, { name: "internal_error" }],
      [400, { name: "invalid_request" }],
    ] as const) {
      const { ensure } = deps({
        list: () => jsonResponse(body, status),
        create: () => {
          throw new Error("must not create");
        },
      });
      await assert.rejects(
        () => ensureFiskilEndUser({ userId: "user-1", email: "sam@example.com" }, ensure),
        /Fiskil end-user lookup failed/,
      );
    }
  });

  it("reads both list envelope shapes", () => {
    assert.equal(endUserIdFromList([{ id: "eu_a", email: "a@x.com" }], "a@x.com"), "eu_a");
    assert.equal(
      endUserIdFromList({ end_users: [{ end_user_id: "eu_b", email: "b@x.com" }] }, "b@x.com"),
      "eu_b",
    );
    assert.equal(endUserIdFromCreate({ end_user_id: "eu_c" }), "eu_c");
    assert.equal(endUserIdFromCreateError({ name: "end_user_already_exists", id: "err_1" }), undefined);
    assert.equal(endUserIdFromCreateError({ end_user_id: "eu_d" }), "eu_d");
    assert.equal(isFiskilEndUserNotFound(400, { name: "end_user_not_found" }), true);
    assert.equal(isFiskilEndUserNotFound(404, { name: "end_user_not_found" }), true);
    assert.equal(isFiskilEndUserNotFound(401, { name: "unauthorized" }), false);
    assert.equal(isFiskilEndUserAlreadyExists({ name: "end_user_already_exists" }), true);
  });
});

describe("Fiskil end-user delete / leave product", () => {
  it("DELETEs the Fiskil end user and treats 404 as already gone", async () => {
    const { ensure, calls } = deps({
      remove: (id) => {
        assert.equal(id, "eu_gone");
        return jsonResponse({ name: "end_user_not_found" }, 404);
      },
    });
    const result = await deleteFiskilEndUser("eu_gone", ensure);
    assert.equal(result.alreadyGone, true);
    assert.equal(
      calls.some((call) => call.method === "DELETE" && call.url === `${FISKIL_API_BASE}/end-users/eu_gone`),
      true,
    );
    assert.ok(calls.filter((call) => call.url.includes("/end-users/")).every((call) => call.authorization === "Bearer tok_app"));
  });

  it("account-delete removes the mapping after a successful remote delete", async () => {
    const { ensure, calls } = deps({
      remove: () => new Response(null, { status: 204 }),
    });
    await ensure.store.put({ userId: "user-1", endUserId: "eu_leave", email: "sam@example.com" });
    const left = await leaveOpenBankingProduct(
      { userId: "user-1", reason: "account_delete" },
      { ...ensure, endUsers: ensure.store, credentials: CREDENTIALS },
    );
    assert.equal(left.ok, true);
    if (!left.ok) return;
    assert.equal(left.deleted, true);
    assert.equal(left.endUserId, "eu_leave");
    assert.equal(await ensure.store.getByUserId("user-1"), undefined);
    assert.equal(
      calls.some((call) => call.method === "DELETE" && call.url === `${FISKIL_API_BASE}/end-users/eu_leave`),
      true,
    );
    assert.equal(
      calls.every((call) => !JSON.stringify(call.body ?? {}).includes("super-secret-value") || call.url === FISKIL_TOKEN_URL),
      true,
    );
  });

  it("skips delete when there is no linked end user", async () => {
    const { ensure, calls } = deps();
    const left = await leaveOpenBankingProduct(
      { userId: "user-missing", reason: "account_delete" },
      { ...ensure, endUsers: ensure.store, credentials: CREDENTIALS },
    );
    assert.equal(left.ok, true);
    if (!left.ok) return;
    assert.equal(left.skipped, true);
    assert.equal(
      calls.some((call) => call.method === "DELETE"),
      false,
    );
  });

  it("surfaces error_id when Fiskil delete fails", async () => {
    const { ensure } = deps({
      remove: () => jsonResponse({ id: "err_del", name: "internal_error" }, 500),
    });
    await ensure.store.put({ userId: "user-1", endUserId: "eu_fail", email: "sam@example.com" });
    const left = await leaveOpenBankingProduct(
      { userId: "user-1", reason: "last_bank_disconnect" },
      { ...ensure, endUsers: ensure.store, credentials: CREDENTIALS },
    );
    assert.equal(left.ok, false);
    if (left.ok) return;
    assert.equal(left.status, 502);
    assert.equal(left.errorId, "err_del");
    assert.equal((await ensure.store.getByUserId("user-1"))?.endUserId, "eu_fail");
  });
});

describe("Open Banking provision gate", () => {
  it("refuses create/link when the OPEN_BANKING bundle toggle is off", async () => {
    const { ensure } = deps();
    const refused = await provisionOpenBankingEndUser(
      { userId: "user-1", email: "sam@example.com", featureToggles: { OPEN_BANKING: false } },
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
      list: () =>
        jsonResponse(
          { name: "end_user_not_found", message: "end user for clientID : client-id not found" },
          400,
        ),
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
