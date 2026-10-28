// Whether closing the main window may hide it to the tray (pure; no Electron imports).
// "Keep running in the tray" must never hold the window open while the app is
// quitting or Windows is signing out / shutting down: a window that refuses to
// close makes Windows show "this app is preventing shutdown".

/**
 * @param {{isQuitting?: boolean, sessionEnding?: boolean, keepRunningInTray?: unknown}} state
 * @returns {boolean} true when the close should be turned into a hide.
 */
function shouldHideToTray({ isQuitting, sessionEnding, keepRunningInTray } = {}) {
  return keepRunningInTray === true && !isQuitting && !sessionEnding;
}

/** How long a query-session-end flag is trusted if no session-end follows
 *  (the user cancelled the sign-out / another app vetoed the shutdown). */
const SESSION_QUERY_GRACE_MS = 15_000;

module.exports = { SESSION_QUERY_GRACE_MS, shouldHideToTray };
