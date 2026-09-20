import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { colourTokens, exceptionTokens, featureFillToken, radiusTokens } from "./tokens";

const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

describe("design system tokens", () => {
  it("binds every colour swatch to a variable declared in globals.css", () => {
    for (const token of [...colourTokens, ...exceptionTokens, featureFillToken]) {
      assert.match(css, new RegExp(`${escapeRegExp(token.cssVar)}\\s*:`), token.cssVar);
    }
  });

  it("binds radius samples to the live radius variables", () => {
    for (const token of radiusTokens) {
      assert.match(css, new RegExp(`${escapeRegExp(token.cssVar)}\\s*:`), token.cssVar);
    }
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
