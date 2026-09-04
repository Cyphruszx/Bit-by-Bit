import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailError, passwordError, signInMessage } from "@/lib/auth/credentials";
import { canSignIn, supabaseConfig } from "./config";

describe("whether this copy has anywhere to sign in to", () => {
  const good = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  };

  it("reads a configured project", () => {
    assert.deepEqual(supabaseConfig(good), {
      url: "https://abc.supabase.co",
      publishableKey: "publishable-key",
    });
    assert.equal(canSignIn(good), true);
  });

  it("says no when nothing is set, which is how the app has always run", () => {
    assert.equal(supabaseConfig({}), null);
    assert.equal(canSignIn({}), false);
  });

  it("treats a half-filled env as not set up rather than crashing on first render", () => {
    assert.equal(canSignIn({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL }), false);
    assert.equal(canSignIn({ ...good, NEXT_PUBLIC_SUPABASE_URL: "  " }), false);
    assert.equal(canSignIn({ ...good, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }), false);
    assert.equal(canSignIn({ ...good, NEXT_PUBLIC_SUPABASE_URL: "http://example.com" }), false);
  });

  it("allows a local project over plain http, and nothing else", () => {
    assert.equal(canSignIn({ ...good, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }), true);
  });
});

describe("what makes an email and a password worth sending", () => {
  it("wants a password long enough to matter", () => {
    assert.match(passwordError("short") ?? "", /at least 12/);
    assert.match(passwordError("alllettersnodigits") ?? "", /number/);
    assert.match(passwordError("1234567890123") ?? "", /letter/);
    assert.equal(passwordError("correct horse 7"), null);
  });

  it("stops at the length bcrypt stops reading", () => {
    // Past 72 bytes the rest is not part of the password, so accepting it would be a lie.
    assert.equal(passwordError(`${"a".repeat(71)}1`), null);
    assert.match(passwordError(`${"a".repeat(72)}1`) ?? "", /at most 72/);
  });

  it("checks the address is one", () => {
    assert.equal(emailError("someone@example.com"), null);
    assert.match(emailError("") ?? "", /Enter your email/);
    assert.match(emailError("someone") ?? "", /does not look like/);
    assert.match(emailError(`${"a".repeat(250)}@example.com`) ?? "", /too long/);
  });

  it("says the same thing whether the address is unknown or the password is wrong", () => {
    // Otherwise the form tells a stranger which addresses have accounts.
    assert.equal(signInMessage("Invalid login credentials"), signInMessage("User not found"));
    assert.match(signInMessage("Email rate limit exceeded"), /Wait a minute/);
    assert.match(signInMessage("Email not confirmed"), /confirm/);
  });
});
