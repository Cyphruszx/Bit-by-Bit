import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FiskilApiError,
  fiskilErrorFromResponse,
  isRetryableError,
  parseFiskilErrorBody,
  withFiskilRetry,
} from "./errors";

describe("Fiskil error shapes", () => {
  it("reads id/name/message plus temporary/timeout/fault flags", () => {
    const parsed = parseFiskilErrorBody({
      id: "err_acde070d-8c4c-4f0d-9d8a-162843c10333",
      name: "InvalidRequest",
      message: "The end_user_id parameter is required",
      temporary: false,
      timeout: false,
      fault: false,
    });
    assert.equal(parsed.errorId, "err_acde070d-8c4c-4f0d-9d8a-162843c10333");
    assert.equal(parsed.errorName, "invalidrequest");
    assert.equal(parsed.temporary, false);
  });

  it("reads Auth UI consent error envelopes", () => {
    const parsed = parseFiskilErrorBody({
      error: "auth_session_invalid",
      errorDescription: "Auth session is either terminated or not found.",
      errorType: "AUTH_SESSION_INVALID",
    });
    assert.equal(parsed.errorName, "auth_session_invalid");
    assert.equal(parsed.message, "Auth session is either terminated or not found.");
  });

  it("marks 429/5xx and temporary/timeout as retryable, not 4xx consent", () => {
    const unavailable = fiskilErrorFromResponse(
      503,
      { id: "err_up", name: "upstream_unavailable", temporary: true },
      "Fiskil banking request",
    );
    assert.equal(unavailable.retryable, true);
    assert.equal(unavailable.errorId, "err_up");
    assert.match(unavailable.message, /503/);
    assert.doesNotMatch(unavailable.message, /super-secret-value/);

    const denied = fiskilErrorFromResponse(400, { id: "err_bad", name: "invalid_request" }, "Fiskil banking request");
    assert.equal(denied.retryable, false);
    assert.equal(isRetryableError(denied), false);

    const authish = fiskilErrorFromResponse(401, { name: "unauthorized" }, "Fiskil token request");
    assert.equal(authish.retryable, false);
  });

  it("retries intermittent failures with backoff, then succeeds", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withFiskilRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new FiskilApiError("temporary", {
            status: 503,
            temporary: true,
            timeout: false,
            fault: true,
            retryable: true,
            errorId: "err_tmp",
          });
        }
        return "ok";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
        baseDelayMs: 10,
      },
    );
    assert.equal(result, "ok");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [10, 20]);
  });

  it("does not retry permanent client errors", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withFiskilRetry(async () => {
          attempts += 1;
          throw fiskilErrorFromResponse(400, { id: "err_perm", name: "invalid_request" }, "list");
        }),
      (err: unknown) => {
        assert.ok(err instanceof FiskilApiError);
        assert.equal(err.errorId, "err_perm");
        return true;
      },
    );
    assert.equal(attempts, 1);
  });
});
