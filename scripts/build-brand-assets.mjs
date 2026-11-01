// Builds the app's icon files from the approved logo SVGs in public/brand (copied from
// docs/marketing/logo). Output is committed; this script and its toolchain are not part of
// the app. Run with:  node scripts/build-brand-assets.mjs
// It needs `sharp`; it is found in node_modules or in the pnpm store.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    const store = path.join(root, "node_modules", ".pnpm");
    const dir = readdirSync(store).find((d) => d.startsWith("sharp@"));
    return require(path.join(store, dir, "node_modules", "sharp"));
  }
}
const sharp = loadSharp();

const brand = path.join(root, "public", "brand");
const read = (name) => readFileSync(path.join(brand, name));
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** At or below this the full mark (three pills, ring and tick) blurs, so the simplified
 *  small-size drawing is used (see mark-small.svg). */
const SMALL_MAX = 24;

async function png(svg, size) {
  return sharp(svg, { density: Math.max(72, (72 * size * 4) / 64) })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const markFor = (size) => read(size <= SMALL_MAX ? "mark-small.svg" : "mark.svg");

/** A multi-size .ico whose images are PNGs (supported since Windows Vista). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const out = (rel, data) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log("wrote", rel, data.length);
};

const icoImages = [];
for (const size of ICO_SIZES)
  icoImages.push({ size, data: await png(markFor(size), size) });
out("desktop/icon.ico", buildIco(icoImages));
out("desktop/icon.png", await png(read("mark.svg"), 256));
out("src/app/favicon.ico", buildIco(icoImages.filter((i) => i.size <= 48)));
out("src/app/icon.svg", read("mark.svg"));
out("src/app/apple-icon.png", await png(read("mark.svg"), 180));
out("public/brand/mark-512.png", await png(read("mark.svg"), 512));
out("public/brand/mark-192.png", await png(read("mark.svg"), 192));

if (process.argv.includes("--sheet")) {
  // A zoomed contact sheet of the small sizes, for checking them by eye.
  const sizes = [16, 24, 32, 48];
  const scale = 8;
  const tiles = [];
  let x = 0;
  for (const size of sizes) {
    for (const bg of ["#ffffff", "#1c1f2c"]) {
      const small = await sharp(await png(markFor(size), size))
        .flatten({ background: bg })
        .resize(size * scale, size * scale, { kernel: "nearest" })
        .png()
        .toBuffer();
      tiles.push({ input: small, left: x, top: bg === "#ffffff" ? 0 : 400 });
    }
    x += size * scale + 16;
  }
  const sheet = sharp({
    create: { width: x, height: 800, channels: 3, background: "#888" },
  });
  writeFileSync(
    process.argv[process.argv.indexOf("--sheet") + 1] || "sheet.png",
    await sheet.composite(tiles).png().toBuffer(),
  );
}
if (!existsSync(path.join(brand, "mark-small.svg")))
  throw new Error("mark-small.svg missing");
