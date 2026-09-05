import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paginate } from "./paging";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("cuts a long list into pages of the size asked for", () => {
    const first = paginate(rows(1704), 1, 25);
    assert.equal(first.items.length, 25);
    assert.equal(first.items[0], 1);
    assert.equal(first.items[24], 25);
    assert.equal(first.pageCount, 69);
    assert.equal(first.firstIndex, 0);
    assert.equal(first.total, 1704);
  });

  it("starts the second page where the first one stopped", () => {
    const second = paginate(rows(1704), 2, 25);
    assert.equal(second.items[0], 26);
    assert.equal(second.items[24], 50);
    assert.equal(second.firstIndex, 25);
  });

  it("leaves the last page short rather than padding it", () => {
    const last = paginate(rows(1704), 69, 25);
    assert.equal(last.items.length, 4);
    assert.equal(last.items[0], 1701);
    assert.equal(last.items[3], 1704);
  });

  it("adds no empty page when the list divides exactly", () => {
    assert.equal(paginate(rows(50), 1, 25).pageCount, 2);
    assert.equal(paginate(rows(25), 1, 25).pageCount, 1);
  });

  // The reader can be on page 40 when a filter cuts the list to three rows. Showing them the
  // last page that exists is the difference between a short list and a blank column.
  it("falls back to the last page when the list has shrunk", () => {
    const shrunk = paginate(rows(3), 40, 25);
    assert.equal(shrunk.page, 1);
    assert.equal(shrunk.pageCount, 1);
    assert.deepEqual(shrunk.items, [1, 2, 3]);
  });

  it("clamps a page below the first one", () => {
    for (const asked of [0, -5, Number.NaN]) {
      const page = paginate(rows(100), asked, 25);
      assert.equal(page.page, 1, `asked for ${asked}`);
      assert.equal(page.items[0], 1);
    }
  });

  it("reports one empty page for an empty list", () => {
    const empty = paginate<number>([], 1, 25);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.pageCount, 1);
    assert.equal(empty.total, 0);
  });

  it("keeps a list shorter than one page on a single page", () => {
    const short = paginate(rows(10), 1, 25);
    assert.equal(short.pageCount, 1);
    assert.equal(short.items.length, 10);
  });

  it("honours a shorter page when the reader asks for one", () => {
    const five = paginate(rows(12), 2, 5);
    assert.equal(five.items.length, 5);
    assert.equal(five.items[0], 6);
    assert.equal(five.pageCount, 3);
    assert.equal(paginate(rows(12), 1, 10).items.length, 10);
  });
});
