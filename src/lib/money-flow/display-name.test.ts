import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayName, nameFromPrintedLines } from "./display-name";
import { sourceFromPairs } from "./source";

describe("the printed name", () => {
  it("keeps a NAB Merchant Name as the bank wrote it", () => {
    assert.equal(
      displayName({
        merchant: "Kfc",
        source: sourceFromPairs([
          ["Merchant Name", "Woolworths (Wagga Wagga North)"],
          ["Transaction Details", "WOOLWORTHS 12731 WAGGA"],
        ]),
      }),
      "Woolworths (Wagga Wagga North)",
    );
  });

  it("uses Transaction Details when Merchant Name is blank", () => {
    assert.equal(
      displayName({
        merchant: "Jordan Lee H4756108521",
        source: sourceFromPairs([
          ["Merchant Name", ""],
          ["Transaction Details", "JORDAN LEE H4756108521"],
        ]),
      }),
      "JORDAN LEE H4756108521",
    );
  });

  it("keeps KFC as KFC, not a title-cased copy", () => {
    assert.equal(
      nameFromPrintedLines([
        "8:37pm KFC",
        "Wagga Wagga, NSW KFC WAGGA NORTH, WAGGA WAGGA Purchase",
        "Zap Card **1234 $14.95 $177.64",
      ]),
      "KFC",
    );
  });

  it("takes the counterparty in front of an Osko type line", () => {
    assert.equal(
      nameFromPrintedLines(["6:45pm Osko Payment Received", "JORDAN LEE Osko Payment Received +$200.00 $205.59"]),
      "JORDAN LEE",
    );
  });

  it("still finds the counterparty when the amount wrapped onto the next page", () => {
    assert.equal(
      nameFromPrintedLines(["1:21pm Osko Payment Received", "JANE CITIZEN Osko Payment Received +", "$300.00 $325.51"]),
      "JANE CITIZEN",
    );
  });

  it("takes the payee in front of Payment", () => {
    assert.equal(
      nameFromPrintedLines(["10:51am Payment", "Jordan Lee BetaShare Fund Payment $300.00 $145.49"]),
      "Jordan Lee BetaShare Fund",
    );
  });

  it("keeps a one-line saver transfer as written", () => {
    assert.equal(nameFromPrintedLines(["12:47pm Transfer from Tax +$75.00 $76.26"]), "Transfer from Tax");
  });

  it("reads the name from stored Up lines, even when the working merchant was tidied", () => {
    assert.equal(
      displayName({
        merchant: "Kfc",
        source: sourceFromPairs([
          ["Date", "2026-06-30"],
          ["Lines", "8:37pm KFC\nWagga Wagga, NSW KFC WAGGA NORTH, WAGGA WAGGA Purchase\nZap Card **1234 $14.95 $177.64"],
        ]),
      }),
      "KFC",
    );
    assert.equal(
      displayName({
        merchant: "Osko Payment Received",
        source: sourceFromPairs([
          ["Lines", "6:45pm Osko Payment Received\nJORDAN LEE Osko Payment Received +$200.00 $205.59"],
        ]),
      }),
      "JORDAN LEE",
    );
  });
});
