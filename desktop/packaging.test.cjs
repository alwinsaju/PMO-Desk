// Run with `pnpm test`. Guards the packaging facts the reminder feature relies
// on: the preload and notifier ship in the installer, the Windows toast id
// matches the installer's appId, and the window keeps its security settings.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const main = readFileSync(path.join(__dirname, "main.cjs"), "utf8");

describe("desktop packaging", () => {
  it("ships preload.cjs and pmo-notifier.cjs (desktop/** minus only the tests)", () => {
    const files = pkg.build.files;
    assert.ok(files.includes("desktop/**/*"));
    const excluded = files.filter((f) => f.startsWith("!desktop/"));
    // Nothing else under desktop/ is excluded, so the two new files go in.
    assert.deepEqual(excluded, ["!desktop/*.test.cjs", "!desktop/live-config.json"]);
  });

  it("sets the AppUserModelID to the installer's appId", () => {
    const match = /const APP_USER_MODEL_ID = "([^"]+)";/.exec(main);
    assert.ok(match, "main.cjs declares APP_USER_MODEL_ID");
    assert.equal(match[1], pkg.build.appId);
    assert.match(main, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  });

  it("tells the launch resolver whether this is a packaged build", () => {
    assert.match(main, /packaged: app\.isPackaged/);
  });

  it("loads the preload while keeping the sandbox and context isolation on", () => {
    assert.match(main, /preload: path\.join\(__dirname, "preload\.cjs"\)/);
    assert.match(main, /contextIsolation: true/);
    assert.match(main, /sandbox: true/);
    assert.match(main, /nodeIntegration: false/);
  });

  it("keeps closing the window quitting the app unless the tray setting is on", () => {
    assert.match(main, /app\.on\("window-all-closed", \(\) => app\.quit\(\)\)/);
    assert.match(main, /readDesktopPrefs\(desktopPrefsFile\(\)\)\.keepRunningInTray/);
  });

  it("the preload exposes only the three documented members", () => {
    const preload = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
    assert.match(preload, /exposeInMainWorld\("aiOsDesktop"/);
    assert.match(preload, /isDesktop: true/);
    assert.match(preload, /onOpenTodo\(callback\)/);
    assert.match(preload, /setBadge\(count\)/);
    assert.doesNotMatch(preload, /require\((?!"electron")/);
  });
});
