import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayName } from "./display-name";

describe("the name to show when a reader settled none", () => {
  it("prefers the merchant the bank named over the wording around it", () => {
    assert.equal(
      displayName({
        merchant: "MC BBS878 5550001X MCARE BENEFITS JORDAN LEE",
        description: "MC BBS878 5550001X MCARE BENEFITS JORDAN LEE",
        bank: { merchant: "Medicare" },
      }),
      "Medicare",
    );
  });

  it("falls back to the statement's own wording when no merchant was named", () => {
    assert.equal(
      displayName({ merchant: "", description: "JORDAN LEE H4756108521" }),
      "JORDAN LEE H4756108521",
    );
  });

  it("collapses the whitespace a reader left behind", () => {
    assert.equal(displayName({ merchant: "  Roll   Viet\tCafé " }), "Roll Viet Café");
  });

  it("says Unknown rather than nothing, so a row still has something to click", () => {
    assert.equal(displayName({ merchant: "" }), "Unknown");
    assert.equal(displayName({ merchant: "   " }), "Unknown");
  });

  it("asks the statement for no column names of its own", () => {
    // The whole point of the adapters: a bank's vocabulary lives in its own reader, and a
    // third bank must never mean editing this file. Nothing here may read a source cell.
    assert.ok(!displayName.toString().includes("sourceValue"));
  });
});
