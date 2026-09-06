import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

  it("fails if bank column names return to shared modules", () => {
    // Inspection, not a comment: a third bank must mean one new adapter, not editing
    // every module a row already passes through. Adapters and upgrade.ts may know history.
    const here = path.join(process.cwd(), "src/lib/money-flow");
    const skip = new Set(["nab-statement.ts", "up-statement.ts", "upgrade.ts"]);
    const columns = ["Merchant Name", "Transaction Details"];
    const quotedLines = /['"]Lines['"]/;

    for (const name of readdirSync(here)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || skip.has(name)) continue;
      const text = readFileSync(path.join(here, name), "utf8");
      for (const column of columns) {
        assert.equal(text.includes(column), false, `${name} must not mention ${column}`);
      }
      assert.equal(quotedLines.test(text), false, `${name} must not look up Lines`);
    }
  });
});
