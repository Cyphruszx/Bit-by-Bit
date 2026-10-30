import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundMoney } from "./parse-values";

describe("roundMoney", () => {
  it("rounds a half-cent away from zero", () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(roundMoney(-1.005), -1.01);
  });

  it("leaves amounts that are not a half-cent on the nearer cent", () => {
    assert.equal(roundMoney(1.004), 1);
    assert.equal(roundMoney(1.006), 1.01);
    assert.equal(roundMoney(-1.004), -1);
    assert.equal(roundMoney(-1.006), -1.01);
    assert.equal(roundMoney(86.4), 86.4);
    assert.equal(roundMoney(-14.95), -14.95);
    assert.equal(roundMoney(0), 0);
  });
});
