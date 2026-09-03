import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountKeyFrom,
  accountRefFromText,
  mergeSuggestions,
  normalizeAccountNumber,
  suggestAccountName,
} from "./account-identity";

describe("reading an account off a statement", () => {
  it("takes the account number a letterhead prints, not the BSB beside it", () => {
    const up = `Up is a brand of Bendigo and Adelaide Bank Limited
Jordan Lee
BSB 633 000
Account 700000000
Summary`;

    assert.deepEqual(accountRefFromText(up), { number: "700000000" });
  });

  it("reads the wordings other banks use", () => {
    assert.deepEqual(accountRefFromText("Account Number: 12-3456-7890"), { number: "1234567890" });
    assert.deepEqual(accountRefFromText("Account No. 083004 100200300"), { number: "083004100200300" });
  });

  it("falls back to the digits a card statement leaves showing", () => {
    assert.deepEqual(accountRefFromText("Visa Platinum **** 4321\nStatement period"), { mask: "4321" });
    assert.deepEqual(accountRefFromText("Card ending 4321"), { mask: "4321" });
  });

  it("reads nothing rather than guessing from a page of movements", () => {
    assert.deepEqual(accountRefFromText("25 Aug Woolworths 86.40\n24 Aug Netflix 18.99"), {});
    // A number too short to be an account is not one.
    assert.equal(normalizeAccountNumber("1234"), undefined);
    assert.equal(normalizeAccountNumber("BSB 633-000"), "633000");
  });

  it("only reads the letterhead, so a card named in a movement is not the account", () => {
    const statement = `Up is a brand of Bendigo\nAccount 700000000\n${"filler line\n".repeat(200)}Zap Card **1234 $14.25`;
    assert.deepEqual(accountRefFromText(statement), { number: "700000000" });
  });
});

describe("filing a movement under an account", () => {
  it("prefers the number, then the hidden digits, then a name", () => {
    const at = { institution: "NAB", statement: "nab.csv" };
    assert.equal(accountKeyFrom({ ...at, number: "100200300", name: "Everyday" }), "NAB · 100200300");
    assert.equal(accountKeyFrom({ ...at, mask: "4321" }), "NAB · ···4321");
    assert.equal(accountKeyFrom({ ...at, name: "Tax" }), "NAB · Tax");
  });

  it("uses the statement itself when it says nothing", () => {
    assert.equal(
      accountKeyFrom({ institution: "Commonwealth Bank", statement: "cba.csv" }),
      "Commonwealth Bank · cba.csv",
    );
  });

  it("suggests a name a person would recognise", () => {
    assert.equal(
      suggestAccountName({ institution: "NAB", statement: "nab.csv", number: "100200300" }),
      "NAB ···300",
    );
    assert.equal(suggestAccountName({ institution: "Up", statement: "up.txt", name: "Tax" }), "Tax");
    assert.equal(
      suggestAccountName({ institution: "Commonwealth Bank", statement: "everyday-2026.csv" }),
      "Commonwealth Bank · everyday 2026",
    );
  });
});

describe("offering a merge", () => {
  it("spots a masked account that could be one already known", () => {
    assert.deepEqual(mergeSuggestions(["NAB · 100200300", "NAB · ···300"]), [
      {
        keep: "NAB · 100200300",
        merge: "NAB · ···300",
        reason: "NAB ···300 could be the same account as 100200300",
      },
    ]);
  });

  it("never offers one across two banks", () => {
    assert.deepEqual(mergeSuggestions(["NAB · 100200300", "ANZ · ···300"]), []);
  });

  it("says nothing about two accounts that simply have numbers", () => {
    assert.deepEqual(mergeSuggestions(["NAB · 100200300", "NAB · 400500600"]), []);
  });
});
