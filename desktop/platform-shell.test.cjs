const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { installerPath, isInstallerName } = require("./platform-shell.cjs");

test("only installers the update download could have made are accepted", () => {
  assert.equal(isInstallerName("AI-OS-Setup-6.1.0.exe"), true);
  assert.equal(isInstallerName("AI-OS-Setup-6.1.0-beta_2.exe"), true);
  for (const bad of [
    "setup.exe",
    "AI-OS-Setup-6.1.0.msi",
    "AI-OS-Setup-6.1.0.exe.part",
    "..\\AI-OS-Setup-6.1.0.exe",
    "C:\\AI-OS-Setup-6.1.0.exe",
    "sub/AI-OS-Setup-6.1.0.exe",
    "AI-OS-Setup-..exe",
    "AI-OS-Setup-.exe",
    "",
    null,
    42,
  ]) {
    assert.equal(isInstallerName(bad), false, String(bad));
  }
});

test("the installer path stays inside the Downloads folder", () => {
  const dir = path.join("C:", "Users", "x", "Downloads");
  assert.equal(
    installerPath(dir, "AI-OS-Setup-6.1.0.exe"),
    path.join(dir, "AI-OS-Setup-6.1.0.exe"),
  );
  assert.equal(installerPath(dir, "..\\evil.exe"), null);
});
