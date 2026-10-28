// What to do when the page's renderer process dies (pure; no Electron imports).
// Electron's render-process-gone reasons: clean-exit, abnormal-exit, killed,
// crashed, oom, launch-failed, integrity-failure, memory-eviction.

/** Reloading cannot fix these: the renderer cannot even start. */
const NO_RELOAD_REASONS = new Set(["launch-failed", "integrity-failure"]);
/** This many crashes inside the window means a reload loop; stop offering it. */
const CRASH_LOOP_LIMIT = 3;
const CRASH_LOOP_WINDOW_MS = 60_000;

/** `timestamps` plus `now`, minus those older than the crash-loop window. */
function recordCrash(timestamps, now) {
  return [...timestamps, now].filter((t) => now - t <= CRASH_LOOP_WINDOW_MS);
}

/**
 * @param {{reason?: string, recentCrashes?: number}} input
 *        recentCrashes counts this crash too.
 * @returns {{action: "ignore" | "offer-reload" | "offer-quit", message: string}}
 */
function decideRendererGone({ reason, recentCrashes = 1 } = {}) {
  if (reason === "clean-exit") {
    return { action: "ignore", message: "" };
  }
  const why = reason || "unknown";
  if (NO_RELOAD_REASONS.has(why)) {
    return {
      action: "offer-quit",
      message: `The AI OS window could not start (${why}). Reloading will not help; restart the app.`,
    };
  }
  if (recentCrashes >= CRASH_LOOP_LIMIT) {
    return {
      action: "offer-quit",
      message: `The AI OS window keeps crashing (${why}). Restart the app.`,
    };
  }
  return {
    action: "offer-reload",
    message: `The AI OS window stopped working (${why}).`,
  };
}

module.exports = {
  CRASH_LOOP_LIMIT,
  CRASH_LOOP_WINDOW_MS,
  NO_RELOAD_REASONS,
  decideRendererGone,
  recordCrash,
};
