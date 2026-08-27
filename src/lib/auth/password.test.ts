import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passwordError, isEmail } from "./password";

describe("password rules", () => {
  it("requires length, a letter, and a number", () => {
    assert.equal(passwordError("short1A"), "Use at least 12 characters.");
    assert.equal(passwordError("abcdefghijkl"), "Include at least one number.");
    assert.equal(passwordError("123456789012"), "Include at least one letter.");
    assert.equal(passwordError("correct horse 1"), null);
  });
});

describe("email", () => {
  it("accepts a simple address", () => {
    assert.equal(isEmail("ada@example.com"), true);
    assert.equal(isEmail("nope"), false);
  });
});
