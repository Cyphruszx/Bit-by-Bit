import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteDescription, siteName, siteTagline } from "./brand";

describe("brand copy", () => {
  it("keeps BitbyBit and describes the shipped guest path", () => {
    assert.equal(siteName, "BitbyBit");
    assert.match(siteTagline, /money flow/i);
    assert.match(siteDescription, /csv/i);
    assert.match(siteDescription, /pdf/i);
    assert.match(siteDescription, /photo/i);
    assert.match(siteDescription, /guest/i);
    assert.match(siteDescription, /this browser/i);
  });

  it("does not claim unshipped ingest formats", () => {
    const copy = `${siteTagline} ${siteDescription}`;
    assert.doesNotMatch(copy, /any statement/i);
    assert.doesNotMatch(copy, /spreadsheet/i);
    assert.doesNotMatch(copy, /\bExcel\b/i);
    assert.doesNotMatch(copy, /\bOFX\b/i);
    assert.doesNotMatch(copy, /\bQIF\b/i);
  });
});
