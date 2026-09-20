import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountChromeCopy } from "./account-chrome";

describe("accountChromeCopy", () => {
  it("shows Sign in when nobody is signed in", () => {
    assert.deepEqual(accountChromeCopy(null), {
      signedIn: false,
      label: "Sign in",
      compactLabel: "Sign in",
      title: "Sign in to back up your ledger",
    });
  });

  it("shows the email and a compact Backed up label when signed in", () => {
    assert.deepEqual(accountChromeCopy({ email: "sam@example.com" }), {
      signedIn: true,
      label: "sam@example.com",
      compactLabel: "Backed up",
      title: "Signed in as sam@example.com",
    });
  });

  it("falls back to Signed in when the session has no email", () => {
    assert.deepEqual(accountChromeCopy({ email: "  " }), {
      signedIn: true,
      label: "Signed in",
      compactLabel: "Backed up",
      title: "Signed in",
    });
  });
});
