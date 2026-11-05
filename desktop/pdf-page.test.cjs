// Run with `pnpm test`. The page size of the Dashboard PDF.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { pdfPageFor, pngSize } = require("./pdf-page.cjs");

function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("pngSize", () => {
  it("reads the pixel size from the header", () => {
    assert.deepEqual(pngSize(png(1548, 3156)), { width: 1548, height: 3156 });
  });
  it("returns null for anything that is not a PNG", () => {
    assert.equal(pngSize(Buffer.from("not a picture at all, just text")), null);
    assert.equal(pngSize(Buffer.alloc(4)), null);
    assert.equal(pngSize(png(0, 10)), null);
  });
});

describe("pdfPageFor", () => {
  it("makes a tall dashboard one page: the page is as tall as the picture", () => {
    const page = pdfPageFor({ width: 1548, height: 3156 });
    const imageHeightMm = page.imageWidthMm * (3156 / 1548);
    assert.equal(page.pageWidthMm, 210);
    assert.ok(page.pageHeightMm > 297, "taller than A4");
    assert.ok(page.pageHeightMm >= imageHeightMm + page.marginMm * 2);
    assert.ok(page.pageHeightMm - imageHeightMm < page.marginMm * 2 + 3, "no spare page");
  });
  it("keeps A4 for a picture that already fits it", () => {
    const page = pdfPageFor({ width: 1600, height: 900 });
    assert.equal(page.pageHeightMm, 297);
    assert.equal(page.imageWidthMm, 194);
  });
  it("never goes past the largest page; a very tall picture is made narrower", () => {
    const page = pdfPageFor({ width: 1000, height: 100000 });
    assert.ok(page.pageHeightMm <= 5000);
    assert.ok(page.imageWidthMm < 194);
    assert.ok(page.imageWidthMm * 100 + page.marginMm * 2 <= page.pageHeightMm);
  });
  it("falls back to A4 when the size is unknown", () => {
    const page = pdfPageFor(null);
    assert.equal(page.pageHeightMm, 297);
    assert.equal(page.imageWidthMm, 194);
  });
  it("gives the inch size printToPDF wants", () => {
    const page = pdfPageFor({ width: 1548, height: 3156 });
    assert.ok(Math.abs(page.pageWidthIn - 8.2677) < 0.001);
    assert.ok(Math.abs(page.pageHeightIn * 25.4 - page.pageHeightMm) < 1e-9);
  });
});
