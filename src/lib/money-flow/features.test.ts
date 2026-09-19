import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENABLE_OFFER_KEYS,
  FEATURE_DEFAULTS,
  hasOpenBankingBundle,
  isFeatureEnabled,
  isFeatureKey,
  parseFeatureToggles,
  shouldShowEnableOffer,
} from "./features";

describe("Spec 12 OPEN_BANKING feature gate", () => {
  it("is a Spec 5 key, default off, and not on the Core enable offer", () => {
    assert.equal(isFeatureKey("OPEN_BANKING"), true);
    assert.equal(FEATURE_DEFAULTS.OPEN_BANKING, false);
    assert.equal(isFeatureEnabled(undefined, "OPEN_BANKING"), false);
    assert.equal(hasOpenBankingBundle(undefined), false);
    assert.equal((ENABLE_OFFER_KEYS as readonly string[]).includes("OPEN_BANKING"), false);
    assert.equal(shouldShowEnableOffer(undefined, undefined, true), true);
  });

  it("turns on only when the Open Banking Bundle toggle is set", () => {
    assert.equal(hasOpenBankingBundle({ OPEN_BANKING: true }), true);
    assert.equal(hasOpenBankingBundle({ OPEN_BANKING: false }), false);
    assert.equal(hasOpenBankingBundle({ POOLS: true }), false);
    assert.deepEqual(parseFeatureToggles({ OPEN_BANKING: true, unknown: true }), { OPEN_BANKING: true });
  });
});
