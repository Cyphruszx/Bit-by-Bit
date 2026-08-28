import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDemoMoneySnapshot } from "./demo-snapshot";

describe("isDemoMoneySnapshot", () => {
  it("detects demo-only movements with no uploaded files", () => {
    assert.equal(isDemoMoneySnapshot([], [{ sourceFile: "demo" }, { sourceFile: "demo" }]), true);
  });

  it("does not treat uploads or empty snapshots as demo", () => {
    assert.equal(isDemoMoneySnapshot([{ filename: "cba.csv" }], [{ sourceFile: "demo" }]), false);
    assert.equal(isDemoMoneySnapshot([], []), false);
    assert.equal(isDemoMoneySnapshot([], [{ sourceFile: "cba.csv" }]), false);
  });
});
