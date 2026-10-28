// Pure helpers for the "Hardware acceleration" display setting (desktop/main.cjs).
// Nothing here imports Electron: the filesystem is passed in, so
// `node --test desktop/display-settings.test.cjs` covers it without launching
// the app.
//
// Why a file: Chromium decides at process start whether to use the GPU
// (app.disableHardwareAcceleration() only works before the app is ready), so the
// choice has to be readable synchronously, early, before any window or server
// exists. It lives in <userData>/display-settings.json:
//
//   { "hardwareAcceleration": true }
//
// OFF (the default, also for a missing / unreadable file) = the lean look and
// software rendering. ON = Chromium may use the GPU and the page switches to the
// rich visual effects (<html data-fx="rich">, see src/lib/displayFx.ts).

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const SETTINGS_FILE_NAME = "display-settings.json";

const DEFAULT_SETTINGS = Object.freeze({ hardwareAcceleration: false });

/** Only an explicit `true` turns it on; anything else is the lean default. */
function normalizeSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { hardwareAcceleration: source.hardwareAcceleration === true };
}

function settingsFilePath(userDataDir, path = nodePath) {
  return path.join(userDataDir, SETTINGS_FILE_NAME);
}

/** Reads the settings file synchronously; never throws (a missing or corrupt
 *  file is the default, OFF). */
function readDisplaySettings(file, fs = nodeFs) {
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes the settings atomically (temp file + rename, so a crash mid-write can
 *  never leave a half-written file that would flip the setting). Returns the
 *  normalized settings that were written; throws if the write fails. */
function writeDisplaySettings(file, settings, fs = nodeFs, path = nodePath) {
  const normalized = normalizeSettings(settings);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
  return normalized;
}

/** main.cjs calls app.disableHardwareAcceleration() exactly when this is true. */
function shouldDisableHardwareAcceleration(settings) {
  return normalizeSettings(settings).hardwareAcceleration !== true;
}

/** The page-facing visual mode that goes with a setting. A machine without
 *  hardware graphics acceleration (`gpu`, from describeGpu) is always lean. */
function fxModeFor(settings, gpu) {
  if (gpu && gpu.noHardwareAcceleration) return "lean";
  return normalizeSettings(settings).hardwareAcceleration ? "rich" : "lean";
}

/**
 * What Chromium actually did. `featureStatus` is app.getGPUFeatureStatus();
 * `gpu_compositing` is "enabled" only when the compositor really runs on the
 * GPU (anything else, e.g. "disabled_software" or "unavailable_software", is
 * software rendering). `launchedWithGpu` is what this process was started with.
 */
function describeGpu({ featureStatus, launchedWithGpu }) {
  const compositing =
    featureStatus && typeof featureStatus.gpu_compositing === "string"
      ? featureStatus.gpu_compositing
      : "unknown";
  return {
    launchedWithGpu: Boolean(launchedWithGpu),
    compositing,
    gpuCompositing: compositing === "enabled",
    // Only meaningful when the GPU was allowed: a launch with it switched off
    // is software on purpose and the user may still try turning it on.
    noHardwareAcceleration:
      Boolean(launchedWithGpu) && compositing !== "unknown" && compositing !== "enabled",
  };
}

module.exports = {
  SETTINGS_FILE_NAME,
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsFilePath,
  readDisplaySettings,
  writeDisplaySettings,
  shouldDisableHardwareAcceleration,
  fxModeFor,
  describeGpu,
};
