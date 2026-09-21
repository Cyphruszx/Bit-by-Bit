import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  logFiskilSupport,
  mergeFiskilSupportIds,
  pickFiskilSupportIds,
} from "./log";

describe("Fiskil support logging", () => {
  it("keeps only the four support identifiers", () => {
    assert.deepEqual(
      pickFiskilSupportIds({
        end_user_id: "eu_1",
        consent_id: "consent_1",
        session_id: "sess_1",
        error_id: "err_1",
        email: "sam@example.com",
        client_secret: "super-secret-value",
        access_token: "tok_app",
        name: "Sam",
      }),
      {
        end_user_id: "eu_1",
        consent_id: "consent_1",
        session_id: "sess_1",
        error_id: "err_1",
      },
    );
  });

  it("reads camelCase fields and treats error-shaped id as error_id", () => {
    assert.deepEqual(
      pickFiskilSupportIds({
        endUserId: "eu_2",
        consentId: "consent_2",
        sessionId: "sess_2",
        id: "err_acde070d-8c4c-4f0d-9d8a-162843c10333",
        name: "InvalidRequest",
        message: "The end_user_id parameter is required",
      }),
      {
        end_user_id: "eu_2",
        consent_id: "consent_2",
        session_id: "sess_2",
        error_id: "err_acde070d-8c4c-4f0d-9d8a-162843c10333",
      },
    );
    assert.equal(pickFiskilSupportIds({ id: "consent_not_an_error" }).error_id, undefined);
  });

  it("writes a support line without secrets, tokens, or PII", () => {
    const lines: string[] = [];
    const ids = logFiskilSupport(
      "open_banking.sync.failed",
      { end_user_id: "eu_1", consent_id: "c1", session_id: "s1", error_id: "err_9" },
      {
        status: 502,
        error_name: "upstream_unavailable",
        retryable: true,
        action: "list_transactions",
      },
      (line) => lines.push(line),
    );
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(payload.event, "open_banking.sync.failed");
    assert.equal(payload.end_user_id, "eu_1");
    assert.equal(payload.consent_id, "c1");
    assert.equal(payload.session_id, "s1");
    assert.equal(payload.error_id, "err_9");
    assert.equal(payload.status, 502);
    const serialized = lines[0]!;
    assert.doesNotMatch(serialized, /super-secret-value/);
    assert.doesNotMatch(serialized, /tok_/);
    assert.doesNotMatch(serialized, /@/);
    assert.deepEqual(ids, {
      end_user_id: "eu_1",
      consent_id: "c1",
      session_id: "s1",
      error_id: "err_9",
    });
  });

  it("drops denied extra keys even if a caller tries to log them", () => {
    const lines: string[] = [];
    logFiskilSupport(
      "open_banking.probe",
      { end_user_id: "eu_1" },
      {
        status: 200,
        email: "sam@example.com",
        client_secret: "super-secret-value",
        access_token: "tok_app",
      } as never,
      (line) => lines.push(line),
    );
    assert.doesNotMatch(lines[0]!, /sam@example.com/);
    assert.doesNotMatch(lines[0]!, /super-secret-value/);
    assert.doesNotMatch(lines[0]!, /tok_app/);
  });

  it("merges identifiers without inventing missing ones", () => {
    assert.deepEqual(
      mergeFiskilSupportIds({ end_user_id: "eu" }, { error_id: "err" }, { consent_id: "c" }),
      { end_user_id: "eu", consent_id: "c", error_id: "err" },
    );
  });
});
