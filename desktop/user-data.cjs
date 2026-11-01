// Where the app keeps its data. The folder is named after the old product ("ai-os") and must
// stay that name: PMO records, settings, the audit log and the Tasks engine's data live in it,
// and a different name would make an update start with an empty app. Electron derives the
// folder from package.json's `name`, so this pins it in code instead, which means renaming
// the product (build.productName) can never move it.
const path = require("node:path");

const USER_DATA_FOLDER = "ai-os";

/** `<appData>\ai-os`, e.g. `C:\Users\you\AppData\Roaming\ai-os`. */
function pinnedUserDataDir(appDataDir) {
  return path.join(appDataDir, USER_DATA_FOLDER);
}

/**
 * Pins `userData` before anything reads it. An explicit `--user-data-dir` (tests, QA runs)
 * wins, so a scratch profile never touches the real folder. Returns the folder that is in
 * effect after the call.
 */
function applyUserDataPin(app) {
  if (!app.commandLine.hasSwitch("user-data-dir")) {
    app.setPath("userData", pinnedUserDataDir(app.getPath("appData")));
  }
  return app.getPath("userData");
}

module.exports = { USER_DATA_FOLDER, pinnedUserDataDir, applyUserDataPin };
