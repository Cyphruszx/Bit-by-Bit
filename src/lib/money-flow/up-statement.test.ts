import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { movementsFromUpStatement, nameFromPrintedLines } from "./up-statement";

describe("the name Up printed", () => {
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

  it("has nothing to say about an empty block", () => {
    assert.equal(nameFromPrintedLines([]), "");
    assert.equal(nameFromPrintedLines(["   "]), "");
  });
});

describe("the movement Up's reader hands on", () => {
  const statement = [
    "Financial year Statement",
    "01 Jul 2025 to 30 Jun 2026",
    "Up is a brand of Bendigo and Adelaide Bank Limited",
    "Tuesday, 30th Jun",
    "8:37pm KFC",
    "Wagga Wagga, NSW KFC WAGGA NORTH, WAGGA WAGGA Purchase",
    "Zap Card **1234 $14.95 $177.64",
    "6:45pm Osko Payment Received",
    "JORDAN LEE Osko Payment Received +$200.00 $205.59",
  ].join("\n");

  it("names the movement itself, so nothing shared has to know Up's layout", () => {
    const movements = movementsFromUpStatement(statement, "up.txt");
    assert.deepEqual(
      movements.map((movement) => movement.merchant),
      ["KFC", "JORDAN LEE"],
    );
  });

  it("signs money out from the absence of a plus, and money in from its presence", () => {
    const movements = movementsFromUpStatement(statement, "up.txt");
    assert.deepEqual(
      movements.map((movement) => movement.amount),
      [-14.95, 200],
    );
  });

  it("keeps the printed block beside the reading", () => {
    const [kfc] = movementsFromUpStatement(statement, "up.txt");
    assert.ok(kfc.source);
    assert.equal(kfc.source?.headers.includes("Lines"), true);
    assert.match(kfc.source?.values[kfc.source.headers.indexOf("Lines")] ?? "", /KFC WAGGA NORTH/);
  });
});
