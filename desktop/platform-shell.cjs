// Small rules for the two things the page may ask the shell to open: the data folder
// and an installer that PMO Desk itself downloaded. Pure (no Electron imports). The page
// never names a path.

const path = require("node:path");

const INSTALLER_NAME = /^AI-OS-Setup-[0-9A-Za-z._-]{1,40}\.exe$/;

/** A file name the update download could have produced: no folders, no tricks. */
function isInstallerName(name) {
  return (
    typeof name === "string" &&
    name === path.basename(name) &&
    !name.includes("..") &&
    INSTALLER_NAME.test(name)
  );
}

/** The full installer path inside the Downloads folder, or null when the name is not acceptable. */
function installerPath(downloadsDir, name) {
  return isInstallerName(name) ? path.join(downloadsDir, name) : null;
}

module.exports = { isInstallerName, installerPath };
