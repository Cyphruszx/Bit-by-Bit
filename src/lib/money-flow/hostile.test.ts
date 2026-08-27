import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostileUploadReason } from "./detect";
import { interpretDocuments } from "./interpret";

describe("hostile uploads", () => {
  it("rejects SVG and HTML pretending to be an image", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    assert.equal(hostileUploadReason("x.svg", "image/svg+xml", svg), "SVG files are not accepted.");
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    assert.equal(hostileUploadReason("photo.jpg", "image/jpeg", html), "This file is not a real image.");
  });
});

describe("interpretDocuments", () => {
  it("fails hostile files without extracting movements", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const result = await interpretDocuments([{ filename: "photo.jpg", mime: "image/jpeg", bytes: html }], { ai: null });
    assert.equal(result.files[0]?.processingStatus, "failed");
    assert.equal(result.transactions.length, 0);
  });
});
