// What to do when the page's renderer process dies (pure; no Electron imports).
// Electron's render-process-gone reasons: clean-exit, abnormal-exit, killed,
// crashed, oom, launch-failed, integrity-failure, memory-eviction.

/** Reloading cannot fix these: the renderer cannot even start. */
const NO_RELOAD_REASONS = new Set(["launch-failed", "integrity-failure"]);
/** This many crashes inside the window means a reload loop; stop offering it. The first is\n *  reloaded automatically, the second asks. */
const CRASH_LOOP_LIMIT = 3;
const CRASH_LOOP_WINDOW_MS = 60_000;

/** `timestamps` plus `now`, minus those older than the crash-loop window. */
function recordCrash(timestamps, now) {
  return [...timestamps, now].filter((t) => now - t <= CRASH_LOOP_WINDOW_MS);
}

/**
 * @param {{reason?: string, recentCrashes?: number}} input
 *        recentCrashes counts this crash too.
 * @returns {{action: "ignore" | "auto-reload" | "offer-reload" | "offer-quit", message: string}}
 */
function decideRendererGone({ reason, recentCrashes = 1 } = {}) {
  if (reason === "clean-exit") {
    return { action: "ignore", message: "" };
  }
  const why = reason || "unknown";
  if (NO_RELOAD_REASONS.has(why)) {
    return {
      action: "offer-quit",
      message: `The PMO Desk window could not start (${why}). Reloading will not help; restart the app.`,
    };
  }
  if (recentCrashes >= CRASH_LOOP_LIMIT) {
    return {
      action: "offer-quit",
      message: `The PMO Desk window keeps crashing (${why}). Restart the app.`,
    };
  }
  // The first crash inside the window is reloaded without asking (the data is on disk and a
  // reload usually fixes it); a second one in the same minute asks the person.
  if (recentCrashes <= 1) {
    return {
      action: "auto-reload",
      message: `The PMO Desk window stopped (${why}); reloading it once.`,
    };
  }
  return {
    action: "offer-reload",
    message: `The PMO Desk window stopped working again (${why}).`,
  };
}

module.exports = {
  CRASH_LOOP_LIMIT,
  CRASH_LOOP_WINDOW_MS,
  NO_RELOAD_REASONS,
  decideRendererGone,
  recordCrash,
};
