import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { colourTokens, darkColourTokens, radiusSamples, spaceSamples } from "./tokens";

const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

describe("design system tokens", () => {
  it("uses the reference light names in order", () => {
    assert.deepEqual(
      colourTokens.map((token) => token.name),
      [
        "Brand",
        "Brand deep",
        "Brand 400",
        "Brand 300",
        "Brand tint",
        "Feature fill",
        "Ink",
        "Ink secondary",
        "Muted",
        "Dim",
        "Line",
        "Fill",
      ],
    );
  });

  it("uses the reference dark names in order", () => {
    assert.deepEqual(
      darkColourTokens.map((token) => token.name),
      [
        "Brand",
        "Brand 500",
        "Brand 600",
        "Brand deep",
        "Brand tint",
        "Brand text",
        "Ink",
        "Muted",
        "Dim",
        "Surface",
        "Surface sunk",
        "Line",
      ],
    );
  });

  it("binds every live swatch to a variable declared in globals.css", () => {
    for (const token of [...colourTokens, ...darkColourTokens]) {
      if (!token.cssVar) continue;
      assert.match(css, new RegExp(`${escapeRegExp(token.cssVar)}\\s*:`), token.cssVar);
    }
  });

  it("does not invent a product token for Brand 500", () => {
    const gap = darkColourTokens.find((token) => token.name === "Brand 500");
    assert.equal(gap?.displayHex, "#4F7CF5");
    assert.equal(gap?.cssVar, undefined);
    assert.match(css, /--color-primary:\s*#2f5bd0/i);
    assert.doesNotMatch(css, /#4[fF]7[cC][fF]5/);
  });

  it("uses the reference spacing steps with bar width equal to the px value", () => {
    assert.deepEqual(
      spaceSamples.map((sample) => sample.px),
      [4, 8, 12, 16, 20, 22, 28],
    );
    for (const sample of spaceSamples) {
      assert.match(sample.barClass, new RegExp(`w-\\[${sample.px}px\\]`));
    }
  });

  it("shows the four product radius tokens including Inner", () => {
    assert.deepEqual(
      radiusSamples.map((sample) => [sample.name, sample.value, sample.cssVar]),
      [
        ["Mark", "2", "--radius-mark"],
        ["Inner", "10", "--radius-inner"],
        ["Card", "16", "--radius-card"],
        ["Pill", "999", "--radius-pill"],
      ],
    );
    for (const sample of radiusSamples) {
      assert.match(css, new RegExp(`${escapeRegExp(sample.cssVar)}\\s*:`), sample.cssVar);
    }
    assert.match(css, /--radius-inner:\s*10px/);
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
