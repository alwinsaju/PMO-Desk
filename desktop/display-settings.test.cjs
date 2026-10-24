// Run with `pnpm test`. The hardware-acceleration setting file against a real
// temp directory; nothing here launches Electron.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const settings = require("./display-settings.cjs");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-os-display-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("display settings file", () => {
  it("defaults to OFF (lean, GPU disabled) when the file is missing", () => {
    const file = settings.settingsFilePath(dir);
    assert.equal(path.basename(file), "display-settings.json");
    assert.deepEqual(settings.readDisplaySettings(file), { hardwareAcceleration: false });
    assert.equal(
      settings.shouldDisableHardwareAcceleration(settings.readDisplaySettings(file)),
      true,
    );
  });

  it("round-trips ON and OFF", () => {
    const file = settings.settingsFilePath(dir);
    settings.writeDisplaySettings(file, { hardwareAcceleration: true });
    assert.deepEqual(settings.readDisplaySettings(file), { hardwareAcceleration: true });
    settings.writeDisplaySettings(file, { hardwareAcceleration: false });
    assert.deepEqual(settings.readDisplaySettings(file), { hardwareAcceleration: false });
  });

  it("creates the folder, leaves no temp file behind, and replaces atomically", () => {
    const file = path.join(dir, "nested", "deeper", settings.SETTINGS_FILE_NAME);
    settings.writeDisplaySettings(file, { hardwareAcceleration: true });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [settings.SETTINGS_FILE_NAME]);
  });

  it("treats corrupt or odd content as OFF and never throws", () => {
    const file = settings.settingsFilePath(dir);
    for (const content of [
      "",
      "{not json",
      "[]",
      "null",
      '"yes"',
      '{"hardwareAcceleration":"true"}',
      "{}",
    ]) {
      fs.writeFileSync(file, content);
      assert.deepEqual(
        settings.readDisplaySettings(file),
        { hardwareAcceleration: false },
        content,
      );
    }
  });

  it("only an explicit true turns acceleration on, and drops unknown keys", () => {
    assert.deepEqual(settings.normalizeSettings({ hardwareAcceleration: 1, extra: 1 }), {
      hardwareAcceleration: false,
    });
    assert.deepEqual(
      settings.normalizeSettings({ hardwareAcceleration: true, extra: 1 }),
      {
        hardwareAcceleration: true,
      },
    );
    assert.deepEqual(settings.normalizeSettings(undefined), {
      hardwareAcceleration: false,
    });
  });

  it("disables hardware acceleration exactly when the setting is OFF", () => {
    assert.equal(
      settings.shouldDisableHardwareAcceleration({ hardwareAcceleration: false }),
      true,
    );
    assert.equal(
      settings.shouldDisableHardwareAcceleration({ hardwareAcceleration: true }),
      false,
    );
    assert.equal(settings.shouldDisableHardwareAcceleration(undefined), true);
  });

  it("maps the setting to the page's visual mode", () => {
    assert.equal(settings.fxModeFor({ hardwareAcceleration: true }), "rich");
    assert.equal(settings.fxModeFor({ hardwareAcceleration: false }), "lean");
    assert.equal(settings.fxModeFor(null), "lean");
  });

  it("propagates a write failure (the caller reports it)", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    assert.throws(() =>
      settings.writeDisplaySettings(path.join(blocker, settings.SETTINGS_FILE_NAME), {
        hardwareAcceleration: true,
      }),
    );
  });
});

describe("describeGpu", () => {
  it("reports GPU compositing only when Chromium says 'enabled'", () => {
    assert.equal(
      settings.describeGpu({
        featureStatus: { gpu_compositing: "enabled" },
        launchedWithGpu: true,
      }).gpuCompositing,
      true,
    );
    for (const value of [
      "disabled_software",
      "unavailable_software",
      "disabled_off",
      undefined,
    ]) {
      const gpu = settings.describeGpu({
        featureStatus: { gpu_compositing: value },
        launchedWithGpu: true,
      });
      assert.equal(gpu.gpuCompositing, false, String(value));
    }
    assert.equal(
      settings.describeGpu({ featureStatus: null, launchedWithGpu: false }).compositing,
      "unknown",
    );
  });
});
