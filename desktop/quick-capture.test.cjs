// Run with `pnpm test`. The quick-capture hotkey setting file (real temp directory)
// and its registration lifecycle (a fake globalShortcut); nothing here launches
// Electron or registers a real OS shortcut.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const quick = require("./quick-capture.cjs");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-os-quick-capture-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for Electron's globalShortcut. `taken` = another app owns the keys. */
function fakeShortcuts({ taken = false, throws = false } = {}) {
  const calls = [];
  const handlers = new Map();
  return {
    calls,
    handlers,
    register(accelerator, handler) {
      calls.push(["register", accelerator]);
      if (throws) throw new Error("bad accelerator");
      if (taken) return false;
      handlers.set(accelerator, handler);
      return true;
    },
    unregister(accelerator) {
      calls.push(["unregister", accelerator]);
      handlers.delete(accelerator);
    },
    isRegistered: (accelerator) => handlers.has(accelerator),
  };
}

describe("quick capture settings file", () => {
  it("defaults to OFF when the file is missing", () => {
    const file = quick.settingsFilePath(dir);
    assert.equal(path.basename(file), "quick-capture.json");
    assert.deepEqual(quick.readQuickCaptureSettings(file), { enabled: false });
  });

  it("round-trips ON and OFF, creating the folder and leaving no temp file", () => {
    const file = path.join(dir, "nested", quick.SETTINGS_FILE_NAME);
    quick.writeQuickCaptureSettings(file, { enabled: true });
    assert.deepEqual(quick.readQuickCaptureSettings(file), { enabled: true });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [quick.SETTINGS_FILE_NAME]);
    quick.writeQuickCaptureSettings(file, { enabled: false });
    assert.deepEqual(quick.readQuickCaptureSettings(file), { enabled: false });
  });

  it("treats corrupt or odd content as OFF and never throws", () => {
    const file = quick.settingsFilePath(dir);
    for (const content of [
      "",
      "{not json",
      "[]",
      "null",
      '"yes"',
      '{"enabled":"true"}',
      '{"enabled":1}',
      "{}",
    ]) {
      fs.writeFileSync(file, content);
      assert.deepEqual(quick.readQuickCaptureSettings(file), { enabled: false }, content);
    }
  });

  it("only an explicit true is honoured, and unknown keys are dropped", () => {
    assert.deepEqual(quick.normalizeSettings({ enabled: true, extra: 1 }), {
      enabled: true,
    });
    assert.deepEqual(quick.normalizeSettings(undefined), { enabled: false });
  });
});

describe("the accelerator", () => {
  it("avoids every in-app combination", () => {
    const taken = [
      "Control+K",
      "Control+Space",
      "Control+,",
      "Control+W",
      "Control+M",
      "Control+Tab",
      "Tab",
      "M",
    ];
    const accelerator = quick.DEFAULT_ACCELERATOR;
    assert.ok(!taken.includes(accelerator));
    assert.ok(!/alt/i.test(accelerator), "no Ctrl+Alt combination");
    // Ctrl+Space is the in-app "jump to the command bar"; this one adds Shift.
    assert.equal(accelerator, "Control+Shift+Space");
  });

  it("reads as plain text for the person", () => {
    assert.equal(quick.acceleratorLabel("Control+Shift+Space"), "Ctrl+Shift+Space");
    assert.equal(quick.acceleratorLabel("CommandOrControl+Shift+J"), "Ctrl+Shift+J");
  });
});

describe("createQuickCapture", () => {
  it("registers nothing until it is enabled", () => {
    const shortcuts = fakeShortcuts();
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    assert.deepEqual(shortcuts.calls, []);
    assert.deepEqual(capture.snapshot(), {
      enabled: false,
      registered: false,
      accelerator: "Control+Shift+Space",
      label: "Ctrl+Shift+Space",
      error: null,
    });
  });

  it("registers when enabled, and a press calls onTrigger", () => {
    const shortcuts = fakeShortcuts();
    let presses = 0;
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger: () => (presses += 1),
    });
    const state = capture.enable();
    assert.equal(state.enabled, true);
    assert.equal(state.registered, true);
    assert.equal(state.error, null);
    shortcuts.handlers.get("Control+Shift+Space")();
    assert.equal(presses, 1);
  });

  it("ignores key repeat inside the minimum gap but accepts a later press", () => {
    const shortcuts = fakeShortcuts();
    let presses = 0;
    let clock = 10_000;
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger: () => (presses += 1),
      now: () => clock,
    });
    capture.enable();
    const press = shortcuts.handlers.get("Control+Shift+Space");
    press();
    clock += 50;
    press();
    clock += 50;
    press();
    assert.equal(presses, 1);
    clock += quick.MIN_GAP_MS;
    press();
    assert.equal(presses, 2);
  });

  it("enabling twice registers once", () => {
    const shortcuts = fakeShortcuts();
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    capture.enable();
    capture.enable();
    assert.equal(shortcuts.calls.filter(([name]) => name === "register").length, 1);
  });

  it("reports a taken accelerator without throwing, and keeps the wish to be on", () => {
    const shortcuts = fakeShortcuts({ taken: true });
    const logged = [];
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
      log: (line) => logged.push(line),
    });
    const state = capture.enable();
    assert.equal(state.enabled, true);
    assert.equal(state.registered, false);
    assert.match(state.error, /Ctrl\+Shift\+Space is already used by another app/);
    assert.ok(logged.length > 0);
    // Nothing to unregister, so turning it off must not call unregister.
    assert.deepEqual(capture.disable().error, null);
    assert.equal(
      shortcuts.calls.some(([name]) => name === "unregister"),
      false,
    );
  });

  it("can try again after the other app lets go", () => {
    const shortcuts = fakeShortcuts({ taken: true });
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    assert.equal(capture.enable().registered, false);
    shortcuts.register = (accelerator, handler) => {
      shortcuts.handlers.set(accelerator, handler);
      return true;
    };
    const state = capture.enable();
    assert.equal(state.registered, true);
    assert.equal(state.error, null);
  });

  it("reports a refused accelerator (the register call throws)", () => {
    const shortcuts = fakeShortcuts({ throws: true });
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    const state = capture.enable();
    assert.equal(state.registered, false);
    assert.match(state.error, /would not accept Ctrl\+Shift\+Space/);
  });

  it("does not trust a register call that did not stick", () => {
    const shortcuts = fakeShortcuts();
    shortcuts.register = () => true;
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    const state = capture.enable();
    assert.equal(state.registered, false);
    assert.match(state.error, /already used by another app/);
  });

  it("disable unregisters and clears the error", () => {
    const shortcuts = fakeShortcuts();
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    capture.enable();
    const state = capture.disable();
    assert.equal(state.enabled, false);
    assert.equal(state.registered, false);
    assert.equal(shortcuts.handlers.size, 0);
  });

  it("setEnabled takes only an explicit true as ON", () => {
    const shortcuts = fakeShortcuts();
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    assert.equal(capture.setEnabled("yes").enabled, false);
    assert.equal(capture.setEnabled(true).registered, true);
    assert.equal(capture.setEnabled(false).registered, false);
  });

  it("dispose (quit) unregisters, and is safe to call when nothing is registered", () => {
    const shortcuts = fakeShortcuts();
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    capture.dispose();
    assert.equal(shortcuts.calls.length, 0);
    capture.enable();
    capture.dispose();
    assert.equal(shortcuts.handlers.size, 0);
    assert.equal(capture.snapshot().registered, false);
    capture.dispose();
  });

  it("an unregister that throws never escapes", () => {
    const shortcuts = fakeShortcuts();
    shortcuts.unregister = () => {
      throw new Error("boom");
    };
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {},
    });
    capture.enable();
    assert.doesNotThrow(() => capture.dispose());
  });

  it("a handler that throws never escapes the key press", () => {
    const shortcuts = fakeShortcuts();
    const logged = [];
    const capture = quick.createQuickCapture({
      globalShortcut: shortcuts,
      onTrigger() {
        throw new Error("window gone");
      },
      log: (line) => logged.push(line),
    });
    capture.enable();
    assert.doesNotThrow(() => shortcuts.handlers.get("Control+Shift+Space")());
    assert.ok(logged.some((line) => /window gone/.test(line)));
  });
});

describe("how main.cjs and preload.cjs use it (source checks, like packaging.test.cjs)", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

  it("only the main window may use the quick-capture handlers", () => {
    for (const channel of [
      "pmo:quick-capture-ready",
      "quickcapture:get-state",
      "quickcapture:set-enabled",
    ]) {
      const start = main.indexOf(`ipcMain.handle("${channel}"`);
      assert.ok(start >= 0, `main.cjs handles ${channel}`);
      // The handler runs to the next top-level statement (a blank line).
      const end = main.indexOf("\n\n", start);
      assert.match(main.slice(start, end), /isFromMainWindow\(event\)/, channel);
    }
  });

  it("reads the saved setting and registers nothing unless it is ON", () => {
    assert.match(
      main,
      /if \(quickCapture\.readQuickCaptureSettings\(quickCaptureFile\)\.enabled\) \{\s*quickCaptureControl\.enable\(\);/,
    );
    // No registration at module scope or anywhere else except through the controller.
    assert.doesNotMatch(main, /globalShortcut\.register\(/);
  });

  it("gives the shortcut back on quit, and never opens a second window for it", () => {
    const quit = /app\.on\("before-quit"[\s\S]*?\n\}\);/.exec(main);
    assert.ok(quit);
    assert.match(quit[0], /quickCaptureControl\.dispose\(\)/);
    const trigger = /function triggerQuickCapture\(\) \{[\s\S]*?\n\}/.exec(main);
    assert.ok(trigger);
    assert.match(trigger[0], /showMainWindow\(\)/);
    assert.match(trigger[0], /webContents\.send\("pmo:quick-capture"\)/);
    assert.doesNotMatch(trigger[0], /new BrowserWindow/);
  });

  it("the preload exposes only the state, the switch and the press listener", () => {
    assert.match(preload, /quickCapture: \{/);
    assert.match(preload, /ipcRenderer\.invoke\("quickcapture:get-state"\)/);
    assert.match(
      preload,
      /ipcRenderer\.invoke\("quickcapture:set-enabled", enabled === true\)/,
    );
    assert.match(preload, /onQuickCapture\(callback\)/);
    assert.match(preload, /"pmo:quick-capture-ready"/);
  });
});
