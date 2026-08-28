import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  enqueueCloudWrite,
  flushCloudWrites,
  isCloudPersistEnabled,
  persistDestination,
  primeCloudHydration,
  resetPersistRuntime,
  setCloudUserId,
  setHydrating,
  setPersistReady,
} from "./runtime";

afterEach(() => {
  resetPersistRuntime();
});

describe("persistDestination", () => {
  it("writes localStorage when signed out", () => {
    assert.equal(persistDestination(), "local");
    assert.equal(isCloudPersistEnabled(), false);
  });

  it("blocks cloud writes until hydrate succeeds", () => {
    primeCloudHydration("user-1");
    assert.equal(persistDestination(), "memory");
    assert.equal(isCloudPersistEnabled(), false);

    setPersistReady(true);
    setHydrating(false);
    assert.equal(persistDestination(), "cloud");
    assert.equal(isCloudPersistEnabled(), true);
  });

  it("keeps the signed-in user and does not fall back to local after a failed hydrate", () => {
    setCloudUserId("user-1");
    setHydrating(false);
    setPersistReady(false);
    assert.equal(persistDestination(), "memory");
    assert.equal(isCloudPersistEnabled(), false);
  });
});

describe("enqueueCloudWrite", () => {
  it("keeps only the latest snapshot for the same key", async () => {
    const ran: string[] = [];
    enqueueCloudWrite("money", async () => {
      ran.push("first");
    });
    enqueueCloudWrite("money", async () => {
      ran.push("second");
    });
    await flushCloudWrites();
    assert.deepEqual(ran, ["second"]);
  });
});
