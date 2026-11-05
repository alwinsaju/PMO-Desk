// The page size for "Save as PDF" of the Dashboard picture (pure; no Electron imports).
// The picture is one tall image; an A4 page cut it in the middle of a card. The page is as
// wide as A4 and as tall as the picture needs, so the dashboard stays on one page.

const PAGE_WIDTH_MM = 210;
const MIN_PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 8;
// A little air at the bottom so rounding never pushes a sliver onto a second page.
const SLACK_MM = 2;
// Chromium (and most viewers) stop at 200 inches.
const MAX_PAGE_HEIGHT_MM = 5000;
const MM_PER_INCH = 25.4;

/**
 * Width and height of a PNG from its header, or null when it is not a PNG.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number } | null}
 */
function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * @param {{ width: number, height: number } | null} size the picture's pixels
 * @returns {{ pageWidthMm: number, pageHeightMm: number, imageWidthMm: number,
 *             marginMm: number, pageWidthIn: number, pageHeightIn: number }}
 */
function pdfPageFor(size) {
  const fullWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  let imageWidthMm = fullWidth;
  let pageHeightMm = MIN_PAGE_HEIGHT_MM;
  if (size && size.width > 0 && size.height > 0) {
    const ratio = size.height / size.width;
    const wanted = fullWidth * ratio + MARGIN_MM * 2 + SLACK_MM;
    if (wanted > MAX_PAGE_HEIGHT_MM) {
      // Unusually tall: shrink the picture rather than exceed the largest page.
      imageWidthMm = (MAX_PAGE_HEIGHT_MM - MARGIN_MM * 2 - SLACK_MM) / ratio;
      pageHeightMm = MAX_PAGE_HEIGHT_MM;
    } else {
      pageHeightMm = Math.max(MIN_PAGE_HEIGHT_MM, Math.ceil(wanted));
    }
  }
  return {
    pageWidthMm: PAGE_WIDTH_MM,
    pageHeightMm,
    imageWidthMm,
    marginMm: MARGIN_MM,
    pageWidthIn: PAGE_WIDTH_MM / MM_PER_INCH,
    pageHeightIn: pageHeightMm / MM_PER_INCH,
  };
}

module.exports = { pngSize, pdfPageFor };
