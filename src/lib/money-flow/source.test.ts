import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSource, sourceFromCells, sourcePairs, sourceValue } from "./source";

describe("source rows", () => {
  it("keeps a blank NAB column instead of collapsing the row into a map", () => {
    const headers = [
      "Date",
      "Amount",
      "Account Number",
      "",
      "Transaction Type",
      "Transaction Details",
      "Balance",
      "Category",
      "Merchant Name",
      "Processed On",
    ];
    const cells = [
      "30 Jun 26",
      "25000.00",
      "100200300",
      "",
      "TRANSFER CREDIT",
      "SOC-10000000001 SocietyOne",
      "4913.07",
      "Transfers in",
      "",
      "30 Jun 26",
    ];
    const source = sourceFromCells(headers, cells);
    assert.equal(source.headers.length, 10);
    assert.equal(source.headers[3], "");
    assert.equal(source.values[3], "");
    assert.equal(sourceValue(source, "Balance"), "4913.07");
    assert.equal(sourceValue(source, "Merchant Name"), "");
    assert.equal(sourceValue(source, "Processed On"), "30 Jun 26");
    assert.equal(hasSource(source), true);
    const pairs = sourcePairs(source);
    assert.equal(pairs.some((cell) => cell.header === ""), false);
    assert.deepEqual(
      pairs.find((cell) => cell.header === "Merchant Name"),
      { header: "Merchant Name", value: "" },
    );
    assert.deepEqual(
      pairs.find((cell) => cell.header === "Balance"),
      { header: "Balance", value: "4913.07" },
    );
  });
});
