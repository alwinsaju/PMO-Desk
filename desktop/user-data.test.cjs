// Run with `pnpm test`. The user-data folder stays %APPDATA%\ai-os whatever the product is called.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const {
  USER_DATA_FOLDER,
  applyUserDataPin,
  pinnedUserDataDir,
} = require("./user-data.cjs");

const APPDATA = "C:\\Users\\pat\\AppData\\Roaming";

function fakeApp({ override } = {}) {
  const paths = { appData: APPDATA, userData: path.join(APPDATA, "PMO Desk") };
  return {
    paths,
    commandLine: { hasSwitch: (name) => name === "user-data-dir" && Boolean(override) },
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value;
    },
  };
}

describe("user-data folder", () => {
  it("is %APPDATA%\\ai-os", () => {
    assert.equal(USER_DATA_FOLDER, "ai-os");
    assert.equal(pinnedUserDataDir(APPDATA), path.join(APPDATA, "ai-os"));
  });

  it("is pinned even when Electron would have named it after the product", () => {
    const app = fakeApp();
    assert.equal(applyUserDataPin(app), path.join(APPDATA, "ai-os"));
    assert.equal(app.getPath("userData"), path.join(APPDATA, "ai-os"));
  });

  it("leaves an explicit --user-data-dir alone (scratch profiles for tests and QA)", () => {
    const app = fakeApp({ override: true });
    assert.equal(applyUserDataPin(app), path.join(APPDATA, "PMO Desk"));
  });

  it("main.cjs pins it before the first time anything reads userData", () => {
    const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
    const pin = main.indexOf("applyUserDataPin(app)");
    const firstRead = main.indexOf('app.getPath("userData")');
    assert.ok(pin > 0, "main.cjs calls applyUserDataPin");
    assert.ok(pin < firstRead, "the pin comes before the first userData read");
  });

  it("package.json keeps the technical names that existing installs depend on", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
    );
    assert.equal(pkg.name, "ai-os");
    assert.equal(pkg.build.appId, "com.aios.desktop");
    assert.equal(pkg.build.productName, "PMO Desk");
  });
});
