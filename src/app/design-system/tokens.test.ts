import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  colourTokens,
  darkColourTokens,
  gridSample,
  radiusSamples,
  shadowSamples,
  spaceSamples,
  typeFaces,
} from "./tokens";

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
        ["Mark", "2px", "--radius-mark"],
        ["Inner", "2px", "--radius-inner"],
        ["Card", "4px", "--radius-card"],
        ["Pill", "4px", "--radius-pill"],
      ],
    );
    for (const sample of radiusSamples) {
      assert.match(
        css,
        new RegExp(`${escapeRegExp(sample.cssVar)}\\s*:\\s*${escapeRegExp(sample.value)}`),
        sample.cssVar,
      );
    }
    assert.match(css, /--radius-full:\s*4px/);
    assert.match(css, /--radius-inner:\s*2px/);
  });

  it("keeps a hybrid type pair and hard offset shadows", () => {
    assert.deepEqual(
      typeFaces.map((face) => face.cssVar),
      ["--font-display", "--font-sans"],
    );
    assert.deepEqual(
      shadowSamples.map((sample) => [sample.cssVar, sample.value]),
      [
        ["--shadow-card", "2px 2px 0"],
        ["--header-shadow", "2px 2px 0"],
      ],
    );
    assert.equal(gridSample.px, 8);
    assert.match(css, /--sweep-grid-size:\s*8px/);
    assert.match(css, /background-size:\s*var\(--sweep-grid-size\)/);
    assert.match(css, /--shadow-card:\s*2px 2px 0 #123a8f/);
    assert.match(css, /--header-shadow:\s*2px 2px 0 #123a8f/);
    assert.doesNotMatch(css, /backdrop-filter/);
  });

  it("keeps gallery chrome on named section-01 tokens", () => {
    const gallery = readFileSync(new URL("./gallery.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(gallery, /bg-chart-5/);
    assert.doesNotMatch(gallery, /rgba?\(/);
    assert.doesNotMatch(gallery, /bg-\[#/);
    assert.doesNotMatch(gallery, /border-\[#/);
    assert.doesNotMatch(gallery, /border-\[rgba/);
    assert.doesNotMatch(gallery, /bg-canvas/);
    assert.doesNotMatch(gallery, /bg-surface-faint/);
    assert.doesNotMatch(gallery, /bg-mark-[1-4]/);
    assert.match(gallery, /fill = "bg-accent-surface"/);
    assert.match(gallery, /fill="bg-chart-4"/);
    assert.match(gallery, /ink \(`--color-ink`\) is #101214/);
    assert.match(gallery, /font-display text-\[32px\]/);
    assert.match(gallery, /font-sans text-\[27px\].*tabular-nums/);
    assert.match(gallery, /font-display text-base/);
    assert.match(gallery, /Pixelify Sans at 16px and up/);
    assert.match(gallery, /Pixelify \+ Public Sans/);
    assert.doesNotMatch(gallery, /Press Start 2P/);
    assert.doesNotMatch(gallery, /Silkscreen/);
    assert.doesNotMatch(gallery, /font-display[^"'\n]*tracking-tight/);
  });
});

describe("pixel restyle locks", () => {
  it("does not remap live colour token hexes", () => {
    const light = [
      ["--color-canvas", "#e2e8f3"],
      ["--color-surface", "#ffffff"],
      ["--color-ink", "#101214"],
      ["--color-primary", "#1b4fd8"],
      ["--color-primary-strong", "#123a8f"],
      ["--color-secondary", "#5a8bf0"],
      ["--color-positive", "#1b4fd8"],
      ["--color-negative", "#101214"],
      ["--color-chart-1", "#123a8f"],
      ["--color-chart-2", "#1b4fd8"],
      ["--color-chart-3", "#5a8bf0"],
      ["--color-chart-4", "#9dbaf7"],
    ] as const;
    for (const [name, hex] of light) {
      assert.match(css, new RegExp(`${escapeRegExp(name)}:\\s*${hex}`), name);
    }
    assert.match(css, /html\.dark[\s\S]*--color-primary:\s*#2f5bd0/);
    assert.match(css, /html\.dark[\s\S]*--color-secondary:\s*#6f9bff/);
  });

  it("loads Pixelify Sans as --font-display and skips Press Start 2P", () => {
    const layout = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
    assert.match(layout, /Pixelify_Sans/);
    assert.match(layout, /variable:\s*"--font-display"/);
    assert.match(layout, /Public_Sans/);
    assert.doesNotMatch(layout, /Press_Start_2P/);
    assert.doesNotMatch(layout, /Silkscreen/);
    assert.doesNotMatch(css, /Press Start 2P/i);
    assert.match(css, /letter-spacing:\s*0\.02em/);
    assert.match(css, /-webkit-font-smoothing:\s*antialiased/);
  });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
