import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BANKING_PAGE_SIZE,
  FiskilAuthError,
  firstSyncFrom,
  isPendingBankStatus,
  listFiskilTransactions,
  MAX_BANKING_PAGES,
  nextBankingPage,
  nextPageAfter,
  parseAccount,
  parseTransaction,
} from "./banking";
import { FISKIL_API_BASE, FISKIL_TOKEN_URL, type FiskilCredentials } from "./config";
import { FiskilApiError } from "./errors";
import { SANDBOX_ACCOUNT, SANDBOX_TRANSACTION } from "./sandbox-shapes";
import { memoryTokenCache } from "./token";

const CREDENTIALS: FiskilCredentials = { clientId: "client-id", clientSecret: "super-secret-value" };

describe("Fiskil banking mapping", () => {
  it("prefers posted datetime and maps PENDING vs POSTED", () => {
    const pending = parseTransaction({
      id: "tx_p",
      account_id: "acc_1",
      amount: "-4.00",
      description: "Hold",
      status: "PENDING",
      execution: "2026-09-18T10:00:00.000Z",
    });
    assert.equal(pending?.status, "PENDING");
    assert.equal(pending?.dateIso, "2026-09-18");
    assert.equal(isPendingBankStatus("PENDING"), true);

    const posted = parseTransaction({
      id: "tx_c",
      account_id: "acc_1",
      amount: 12,
      type: "DEBIT",
      description: "Shop",
      status: "POSTED",
      posted: "2026-09-19T03:00:00.000Z",
      execution: "2026-09-18T10:00:00.000Z",
    });
    assert.equal(posted?.status, "POSTED");
    assert.equal(posted?.dateIso, "2026-09-19");
    assert.equal(posted?.amount, -12);
  });

  it("keeps live sandbox accounts that use display_name / fiskil_id / account_id", () => {
    const account = parseAccount(SANDBOX_ACCOUNT);
    assert.equal(account?.id, "acc_sandbox_everyday");
    assert.equal(account?.name, "Transaction Account");
    assert.equal(account?.institutionName, "Banking Sandbox Data Holder");
    assert.deepEqual(account?.aliases, ["fia_sandbox_everyday"]);
  });

  it("keeps live sandbox transactions that use transaction_id / fiskil_id / execution_date_time", () => {
    const txn = parseTransaction(SANDBOX_TRANSACTION);
    assert.equal(txn?.id, "txn_sandbox_coffee");
    assert.equal(txn?.accountId, "acc_sandbox_everyday");
    assert.equal(txn?.dateIso, "2026-09-10");
    assert.equal(txn?.amount, -12.5);
    assert.equal(txn?.status, "POSTED");
  });

  it("first-sync window is 90 days", () => {
    const from = firstSyncFrom(Date.parse("2026-09-19T00:00:00.000Z"));
    assert.equal(from.startsWith("2026-06-21"), true);
  });

  it("reads Fiskil pagination cursors from links, meta, and has_more", () => {
    assert.equal(
      nextPageAfter({
        links: { next: "https://api.fiskil.com/v1/banking/transactions?page%5Bafter%5D=cur_2&page%5Bsize%5D=1000" },
      }),
      "cur_2",
    );
    assert.equal(nextPageAfter({ links: { after: "cur_plain" } }), "cur_plain");
    assert.equal(nextPageAfter({ links: { next: { href: "?page[after]=cur_href" } } }), "cur_href");
    assert.equal(nextPageAfter({ meta: { page: { after: "cur_meta" } } }), "cur_meta");
    assert.equal(nextPageAfter({ has_more: true, cursor: "cur_more" }), "cur_more");
    assert.equal(nextBankingPage({ links: { next: "/v1/banking/transactions?foo=1" } })?.href, "/v1/banking/transactions?foo=1");
    assert.equal(nextPageAfter({ transactions: [] }), undefined);
  });

  it("walks every transaction page for a 90-day fetch", async () => {
    const pages: string[] = [];
    const tx = (id: string) => ({
      id,
      account_id: "acc_1",
      amount: -1,
      description: id,
      status: "POSTED",
      posted: "2026-09-10T00:00:00.000Z",
    });
    const rows = await listFiskilTransactions(
      { endUserId: "eu_1", from: firstSyncFrom(Date.parse("2026-09-19T00:00:00.000Z")) },
      {
        credentials: CREDENTIALS,
        cache: memoryTokenCache(),
        sleep: async () => {},
        fetchImpl: async (input) => {
          const url = String(input);
          if (url === FISKIL_TOKEN_URL) {
            return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          const after = new URL(url).searchParams.get("page[after]");
          pages.push(after ?? "first");
          assert.equal(new URL(url).searchParams.get("page[size]"), String(BANKING_PAGE_SIZE));
          assert.equal(new URL(url).searchParams.get("end_user_id"), "eu_1");
          if (!after) {
            return new Response(
              JSON.stringify({
                transactions: [tx("tx_1")],
                links: { next: `${FISKIL_API_BASE}/banking/transactions?page[after]=cur_2` },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (after === "cur_2") {
            return new Response(
              JSON.stringify({
                transactions: [tx("tx_2")],
                links: { next: `${FISKIL_API_BASE}/banking/transactions?page[after]=cur_3` },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ transactions: [tx("tx_3")] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    );
    assert.deepEqual(pages, ["first", "cur_2", "cur_3"]);
    assert.deepEqual(rows.map((row) => row.id), ["tx_1", "tx_2", "tx_3"]);
  });

  it("retries intermittent banking 503s then fails loudly with error_id", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        listFiskilTransactions(
          { endUserId: "eu_1" },
          {
            credentials: CREDENTIALS,
            cache: memoryTokenCache(),
            sleep: async () => {},
            fetchImpl: async (input) => {
              const url = String(input);
              if (url === FISKIL_TOKEN_URL) {
                return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
              attempts += 1;
              return new Response(JSON.stringify({ id: "err_up", name: "upstream_unavailable", temporary: true }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              });
            },
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof FiskilApiError);
        assert.equal(err.errorId, "err_up");
        assert.equal(err.retryable, true);
        return true;
      },
    );
    assert.equal(attempts, 3);
  });

  it("does not retry consent refusals", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        listFiskilTransactions(
          { endUserId: "eu_1" },
          {
            credentials: CREDENTIALS,
            cache: memoryTokenCache(),
            sleep: async () => {},
            fetchImpl: async (input) => {
              if (String(input) === FISKIL_TOKEN_URL) {
                return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
              attempts += 1;
              return new Response(JSON.stringify({ id: "err_auth", name: "forbidden" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
              });
            },
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof FiskilAuthError);
        assert.equal(err.errorId, "err_auth");
        return true;
      },
    );
    assert.equal(attempts, 1);
  });

  it("fails instead of silently truncating when the page cap still has a next cursor", async () => {
    await assert.rejects(
      () =>
        listFiskilTransactions(
          { endUserId: "eu_1" },
          {
            credentials: CREDENTIALS,
            cache: memoryTokenCache(),
            sleep: async () => {},
            fetchImpl: async (input) => {
              if (String(input) === FISKIL_TOKEN_URL) {
                return new Response(JSON.stringify({ token: "tok_app", expires_in: 900 }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
              return new Response(
                JSON.stringify({
                  transactions: [],
                  links: { next: `${FISKIL_API_BASE}/banking/transactions?page[after]=still_more` },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              );
            },
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof FiskilApiError);
        assert.equal(err.errorName, "pagination_incomplete");
        return true;
      },
    );
    assert.equal(MAX_BANKING_PAGES, 100);
  });

  it("keeps an MCC already on the transaction payload", () => {
    const txn = parseTransaction({
      id: "tx_mcc",
      account_id: "acc_1",
      amount: -18.5,
      description: "Unknown counter",
      status: "POSTED",
      posted: "2026-09-19T03:00:00.000Z",
      merchant: { name: "Corner Shop", merchant_category_code: "5411" },
    });
    assert.equal(txn?.mcc, "5411");
    assert.equal(txn?.merchant, "Corner Shop");
  });
});
