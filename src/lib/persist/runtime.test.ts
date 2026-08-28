import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  enqueueCloudWrite,
  flushCloudWrites,
  hasDeferredWrite,
  isCloudPersistEnabled,
  isHydrating,
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

  it("does not mark a failed session as hydrating again on re-render", () => {
    primeCloudHydration("user-1");
    setHydrating(false);
    setPersistReady(false);
    primeCloudHydration("user-1");
    assert.equal(isHydrating(), false);
    assert.equal(persistDestination(), "memory");
  });
});

describe("enqueueCloudWrite", () => {
  it("keeps only the latest snapshot for the same key", async () => {
    setCloudUserId("user-1");
    setHydrating(false);
    setPersistReady(true);
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

  it("holds writes until hydrate succeeds, then sends the latest snapshot", async () => {
    const ran: string[] = [];
    primeCloudHydration("user-1");
    enqueueCloudWrite("money", async () => {
      ran.push("during-load");
    });
    enqueueCloudWrite("money", async () => {
      ran.push("latest");
    });
    await flushCloudWrites();
    assert.deepEqual(ran, []);
    setHydrating(false);
    setPersistReady(true);
    await flushCloudWrites();
    assert.deepEqual(ran, ["latest"]);
  });

  it("keeps a deferred snapshot so hydrate can skip overwriting that store", async () => {
    primeCloudHydration("user-1");
    enqueueCloudWrite("money", async () => {
      /* held until ready */
    });
    assert.equal(hasDeferredWrite("money"), true);
    assert.equal(hasDeferredWrite("period"), false);
    setHydrating(false);
    setPersistReady(true);
    await flushCloudWrites();
    assert.equal(hasDeferredWrite("money"), false);
  });
});
