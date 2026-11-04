// Pure helpers for the opt-in "Quick capture" global hotkey (desktop/main.cjs).
// Nothing here imports Electron: the globalShortcut module and the filesystem
// are passed in, so `node --test desktop/quick-capture.test.cjs` covers it
// without launching the app.
//
// What it does: while PMO Desk is running and the setting is ON, pressing
// Ctrl+Shift+Space anywhere in Windows shows the main window and tells the page
// (the same way a clicked reminder does, see openTodoFromNotification) to put the
// cursor in the command bar ready to type "/todo ...". It is NOT a second window:
// every shell message handler only answers the main window.
//
// Why Ctrl+Shift+Space: it is the "next door" of the in-app Ctrl+Space (jump to
// the command bar), and the page ignores it (isFocusBarShortcut refuses Shift), so
// it clashes with none of the in-app combinations (Ctrl+K, Ctrl+Space, Ctrl+,
// Ctrl+W, Ctrl+M, Ctrl+Tab, Ctrl+Alt+...). A global shortcut can still clash with
// another app, which is why this is OFF by default, and why a failed
// registration is reported to the setting instead of being swallowed.
//
// The setting lives in <userData>/quick-capture.json, like display-settings.cjs:
//
//   { "enabled": false }
//
// OFF (the default, also for a missing / unreadable file) = nothing is registered.

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const SETTINGS_FILE_NAME = "quick-capture.json";

const DEFAULT_SETTINGS = Object.freeze({ enabled: false });

/** Electron accelerator syntax (Windows: Control = Ctrl). */
const DEFAULT_ACCELERATOR = "Control+Shift+Space";

/** Holding the keys down repeats the OS hotkey; one press is one capture. */
const MIN_GAP_MS = 400;

/** Only an explicit `true` turns it on; anything else is the default, OFF. */
function normalizeSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { enabled: source.enabled === true };
}

function settingsFilePath(userDataDir, path = nodePath) {
  return path.join(userDataDir, SETTINGS_FILE_NAME);
}

/** Reads the settings file synchronously; never throws (a missing or corrupt
 *  file is the default, OFF). */
function readQuickCaptureSettings(file, fs = nodeFs) {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes the settings atomically (temp file + rename). Returns the normalized
 *  settings that were written; throws if the write fails. */
function writeQuickCaptureSettings(file, settings, fs = nodeFs, path = nodePath) {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
  return normalized;
}

/** "Control+Shift+Space" -> "Ctrl+Shift+Space", for the text the person reads. */
function acceleratorLabel(accelerator) {
  return String(accelerator)
    .split("+")
    .map((part) =>
      /^(?:control|ctrl|commandorcontrol|cmdorctrl)$/i.test(part) ? "Ctrl" : part,
    )
    .join("+");
}

function takenMessage(accelerator) {
  return (
    `${acceleratorLabel(accelerator)} is already used by another app, so quick capture ` +
    "is not active. Close that app, or turn this off."
  );
}

function rejectedMessage(accelerator) {
  return `Windows would not accept ${acceleratorLabel(accelerator)} as a shortcut, so quick capture is not active.`;
}

/**
 * The hotkey's lifecycle. `globalShortcut` is Electron's module (register,
 * unregister, isRegistered); `onTrigger` runs on each press.
 *
 *   snapshot()  -> { enabled, registered, accelerator, label, error }
 *   setEnabled(on) / enable() / disable()  -> snapshot
 *   dispose()   unregisters (call on quit); never throws
 *
 * `error` is a plain sentence when the person asked for the hotkey but it could
 * not be registered (taken by another app, or refused); otherwise null.
 */
function createQuickCapture({
  globalShortcut,
  onTrigger,
  accelerator = DEFAULT_ACCELERATOR,
  log = () => {},
  now = Date.now,
  minGapMs = MIN_GAP_MS,
}) {
  let enabled = false;
  let registered = false;
  let error = null;
  let lastTriggerAt = -Infinity;

  function handler() {
    const at = now();
    if (at - lastTriggerAt < minGapMs) return;
    lastTriggerAt = at;
    try {
      onTrigger();
    } catch (cause) {
      // A broken handler must never take the main process down.
      log(`Quick capture handler failed: ${cause && cause.message}`);
    }
  }

  function snapshot() {
    return {
      enabled,
      registered,
      accelerator,
      label: acceleratorLabel(accelerator),
      error,
    };
  }

  function unregister() {
    if (!registered) return;
    registered = false;
    try {
      globalShortcut.unregister(accelerator);
    } catch (cause) {
      log(`Could not unregister ${accelerator}: ${cause && cause.message}`);
    }
  }

  function enable() {
    enabled = true;
    if (registered) return snapshot();
    error = null;
    let ok = false;
    let rejected = false;
    try {
      ok = globalShortcut.register(accelerator, handler) === true;
      // A false answer, or one that did not stick, means another app owns the keys.
      if (ok && typeof globalShortcut.isRegistered === "function") {
        ok = globalShortcut.isRegistered(accelerator) === true;
      }
    } catch (cause) {
      rejected = true;
      log(`Could not register ${accelerator}: ${cause && cause.message}`);
    }
    registered = ok;
    if (!ok) {
      error = rejected ? rejectedMessage(accelerator) : takenMessage(accelerator);
      log(
        `Quick capture hotkey ${acceleratorLabel(accelerator)} is not active: ${error}`,
      );
    } else {
      log(`Quick capture hotkey ${acceleratorLabel(accelerator)} registered.`);
    }
    return snapshot();
  }

  function disable() {
    enabled = false;
    error = null;
    unregister();
    return snapshot();
  }

  return {
    snapshot,
    enable,
    disable,
    setEnabled: (on) => (on === true ? enable() : disable()),
    dispose() {
      unregister();
    },
  };
}

module.exports = {
  SETTINGS_FILE_NAME,
  DEFAULT_SETTINGS,
  DEFAULT_ACCELERATOR,
  MIN_GAP_MS,
  normalizeSettings,
  settingsFilePath,
  readQuickCaptureSettings,
  writeQuickCaptureSettings,
  acceleratorLabel,
  createQuickCapture,
};
