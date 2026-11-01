// Run with `pnpm test`. The product is called PMO Desk: no screen, dialog or installer text may
// still say "AI OS". The few places that keep the old name on purpose (data folders that hold
// existing installs' data, the old program name the installer cleans up, the project path) are
// listed below, each with the reason.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const root = path.join(__dirname, "..");
const SCAN = ["src", "desktop", "build/installer.nsh", "package.json", "README.md"];
const SKIP_DIRS = new Set(["node_modules", ".next", "release"]);
const TEXT = /\.(ts|tsx|mjs|cjs|js|json|css|nsh|md|ps1)$/;

const KEPT = [
  /Projects\\{1,2}AI OS/, // the project folder
  /["'`\\/]AI OS["'`\\/]|AI OS[\\/]pmo|AI OS\\pmo/, // %LOCALAPPDATA%\AI OS: existing PMO data
  /AI OS\.exe|AI OS\.lnk|"AI OS"/, // the installer removing the old program and shortcuts
  /Kept as "AI OS"|"AI OS" is the data folder/, // the comments that say why
];

function files(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [dir];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const rel = path.posix.join(dir.replace(/\\/g, "/"), e.name);
    return e.isDirectory() ? files(rel) : TEXT.test(e.name) ? [rel] : [];
  });
}

describe("branding", () => {
  it("no visible text still says AI OS", () => {
    const found = [];
    for (const file of SCAN.flatMap(files)) {
      if (file === "desktop/branding.test.cjs") continue;
      fs.readFileSync(path.join(root, file), "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/AI OS/.test(line) && !KEPT.some((re) => re.test(line))) {
            found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
          }
        });
    }
    assert.deepEqual(found, []);
  });

  it("the installer and shortcuts use the new name", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.build.productName, "PMO Desk");
    assert.equal(pkg.build.nsis.shortcutName, "PMO Desk");
    const nsh = fs.readFileSync(path.join(root, "build/installer.nsh"), "utf8");
    assert.match(nsh, /Welcome to PMO Desk/);
    assert.match(nsh, /Open PMO Desk/);
  });

  it("the logo files the app and installer use exist", () => {
    for (const f of [
      "public/brand/mark.svg",
      "public/brand/mark-dark.svg",
      "public/brand/mark-mono.svg",
      "public/brand/mark-small.svg",
      "public/brand/deloitte-light.png",
      "public/brand/deloitte-dark.png",
      "desktop/icon.ico",
      "desktop/icon.png",
      "src/app/favicon.ico",
      "src/app/icon.svg",
      "src/app/apple-icon.png",
      "build/installer/sidebar.bmp",
      "build/installer/header.bmp",
    ]) {
      assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
    }
  });

  it("desktop/icon.ico holds every size Windows asks for", () => {
    const ico = fs.readFileSync(path.join(root, "desktop/icon.ico"));
    const count = ico.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i++) sizes.push(ico[6 + i * 16] || 256);
    assert.deepEqual(
      sizes.sort((a, b) => a - b),
      [16, 24, 32, 48, 64, 128, 256],
    );
  });
});
