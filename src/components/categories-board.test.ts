import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./categories-board.tsx", import.meta.url), "utf8");

describe("categories page", () => {
  it("names the category actions and leaves archived restore and subcategories out", () => {
    assert.match(source, /aria-label="Rename category"/);
    assert.match(source, /aria-label="Archive category"/);
    assert.match(source, /aria-haspopup="dialog"/);
    assert.match(source, /aria-expanded=\{archiveOpen\}/);
    assert.match(source, /Move to group…/);
    assert.doesNotMatch(source, /Show archived/);
    assert.doesNotMatch(source, /subcategor/i);
    assert.doesNotMatch(source, /text-attention/);
    assert.doesNotMatch(source, /Bring one back/);
    assert.doesNotMatch(source, /Guest|Core tier|Free tier/i);
    assert.doesNotMatch(source, /data stays in your browser/i);
  });
});
