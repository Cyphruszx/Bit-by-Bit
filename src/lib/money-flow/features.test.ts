import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canShowConnectBank } from "@/lib/open-banking/connect-flow";
import { EMPTY_LEDGER, recordFeatureToggle } from "./ledger";
import {
  ENABLE_OFFER_KEYS,
  ENABLE_OFFER_LABELS,
  FEATURE_DEFAULTS,
  hasOpenBankingBundle,
  isFeatureEnabled,
  isFeatureKey,
  OPEN_BANKING_LABEL,
  OPEN_BANKING_STUB_NOTE,
  openBankingControlMode,
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
    assert.equal("OPEN_BANKING" in ENABLE_OFFER_LABELS, false);
    assert.equal(shouldShowEnableOffer(undefined, undefined, true), true);
    assert.equal(shouldShowEnableOffer({ OPEN_BANKING: true }, undefined, true), true);
  });

  it("turns on only when the Open Banking Bundle toggle is set", () => {
    assert.equal(hasOpenBankingBundle({ OPEN_BANKING: true }), true);
    assert.equal(hasOpenBankingBundle({ OPEN_BANKING: false }), false);
    assert.equal(hasOpenBankingBundle({ POOLS: true }), false);
    assert.deepEqual(parseFeatureToggles({ OPEN_BANKING: true, unknown: true }), { OPEN_BANKING: true });
  });
});

describe("Spec 12 OPEN_BANKING panel UX", () => {
  it("uses a full enable control when off and a compact turn-off when on", () => {
    assert.equal(openBankingControlMode(false), "full");
    assert.equal(openBankingControlMode(true), "compact");
    assert.equal(OPEN_BANKING_LABEL, "Open Banking");
    assert.match(OPEN_BANKING_STUB_NOTE, /paid-bundle stub/i);
    assert.match(OPEN_BANKING_STUB_NOTE, /billing is not wired yet/i);
  });

  it("keeps Connect bank hidden until setFeatureOn / recordFeatureToggle turns the gate on", () => {
    assert.equal(canShowConnectBank(FEATURE_DEFAULTS.OPEN_BANKING), false);
    assert.equal(canShowConnectBank(isFeatureEnabled(undefined, "OPEN_BANKING")), false);

    const enabled = recordFeatureToggle(EMPTY_LEDGER, "OPEN_BANKING", true);
    assert.equal(enabled.featureToggles?.OPEN_BANKING, true);
    assert.equal(isFeatureEnabled(enabled.featureToggles, "OPEN_BANKING"), true);
    assert.equal(canShowConnectBank(isFeatureEnabled(enabled.featureToggles, "OPEN_BANKING")), true);

    const disabled = recordFeatureToggle(enabled, "OPEN_BANKING", false);
    assert.equal(disabled.featureToggles?.OPEN_BANKING, false);
    assert.equal(canShowConnectBank(isFeatureEnabled(disabled.featureToggles, "OPEN_BANKING")), false);
    assert.deepEqual([...ENABLE_OFFER_KEYS], ["GOALS", "LINKED_BALANCES", "POOLS"]);
  });
});
