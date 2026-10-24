// PMO To-Do reminders for the Electron shell, with every dependency passed in
// (fetch, Notification, timers, the filesystem), so
// `node --test desktop/pmo-notifier.test.cjs` covers it without launching
// Electron. desktop/main.cjs wires in the real ones.
//
// What the shell does: every 60 s, while the Next server is up, it POSTs
// /api/pmo/due/claim (with the `x-ai-os-desktop: 1` marker the runtime-stop
// route also asks for; a custom header forces a CORS preflight, so a web page
// cannot send it). The server answers with the reminders nobody has shown yet
// and one ready-made toast (the privacy default, "PMO To-Do: N items need
// attention", is applied there). The shell shows that toast as a Windows
// notification and then acknowledges the claim; a claim it never acknowledges
// (a crash, a failed notification) expires on the server and is offered again.
// Nothing here sends anything anywhere except to the app's own loopback server.

const nodeFs = require("node:fs");

const POLL_INTERVAL_MS = 60_000;
/** Give the server a moment after launch before the first claim. */
const FIRST_POLL_DELAY_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

const DESKTOP_HEADER = { "x-ai-os-desktop": "1" };

/** The tray setting the Next server mirrors into <userData>\desktop-prefs.json
 *  (src/lib/pmo/server/desktopPrefs.ts). Read fresh each time a window closes;
 *  a missing or unreadable file means "off", the default. Never throws. */
function readDesktopPrefs(file, fs = nodeFs) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      keepRunningInTray:
        parsed !== null &&
        typeof parsed === "object" &&
        parsed.keepRunningInTray === true,
    };
  } catch {
    return { keepRunningInTray: false };
  }
}

/** Plain-text label for the taskbar overlay and the tray tooltip. */
function attentionLabel(count) {
  if (!(count > 0)) return "";
  return `PMO To-Do: ${count} ${count === 1 ? "item needs" : "items need"} attention`;
}

// A 3x5 pixel font for the badge digits (and "+").
const GLYPHS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

/**
 * The taskbar overlay badge as a raw 32x32 BGRA bitmap (what
 * nativeImage.createFromBitmap takes): a filled circle with the count, "9+"
 * above 9. Plain arithmetic, so no canvas and no image file is needed.
 */
function renderBadgeBitmap(count, size = 32) {
  const buffer = Buffer.alloc(size * size * 4); // transparent
  const text = count > 9 ? "9+" : String(Math.max(0, Math.floor(count)));
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (y * size + x) * 4;
    buffer[at] = b;
    buffer[at + 1] = g;
    buffer[at + 2] = r;
    buffer[at + 3] = 255;
  };
  const centre = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - centre) ** 2 + (y - centre) ** 2 <= radius * radius)
        put(x, y, [31, 107, 90]);
    }
  }
  const scale = text.length > 1 ? 3 : 4;
  const glyphWidth = 3 * scale;
  const gap = scale;
  const total = text.length * glyphWidth + (text.length - 1) * gap;
  const originX = Math.round((size - total) / 2);
  const originY = Math.round((size - 5 * scale) / 2);
  [...text].forEach((char, index) => {
    const rows = GLYPHS[char];
    if (!rows) return;
    const left = originX + index * (glyphWidth + gap);
    rows.forEach((row, rowIndex) => {
      [...row].forEach((cell, col) => {
        if (cell !== "1") return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            put(
              left + col * scale + dx,
              originY + rowIndex * scale + dy,
              [255, 255, 255],
            );
          }
        }
      });
    });
  });
  return { width: size, height: size, buffer };
}

/**
 * The poller. `deps`:
 *   getBaseUrl()   the app server's origin, e.g. http://127.0.0.1:3100
 *   isReady()      true only while the server is up and not restarting/quitting
 *   fetchImpl      fetch
 *   Notification   Electron's Notification class
 *   onOpenTodo(id) a notification was clicked (id is null for several to-dos)
 *   onAttention(n) the current count of items needing attention
 *   log(msg, level)
 */
function createReminderPoller(deps) {
  const {
    getBaseUrl,
    isReady,
    fetchImpl = globalThis.fetch,
    Notification,
    onOpenTodo,
    onAttention = () => {},
    log = () => {},
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = deps;

  const live = new Set(); // keep shown notifications referenced until closed
  let timer = null;
  let first = null;
  let inFlight = false;
  let lastProblem = "";

  async function post(path, body) {
    const response = await fetchImpl(`${getBaseUrl()}/api/pmo${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...DESKTOP_HEADER },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.json();
  }

  function show(toast) {
    if (typeof Notification.isSupported === "function" && !Notification.isSupported()) {
      throw new Error("Notifications are not supported here.");
    }
    const notification = new Notification({
      title: toast.title,
      body: toast.body || "",
      silent: false,
    });
    live.add(notification);
    notification.on("click", () => {
      try {
        onOpenTodo(typeof toast.todoId === "string" ? toast.todoId : null);
      } catch (error) {
        log(`Opening a reminder failed: ${error && error.message}`, "error");
      }
    });
    notification.on("close", () => live.delete(notification));
    notification.on("failed", (_event, error) => {
      live.delete(notification);
      log(`A reminder notification failed to show: ${error}`, "error");
    });
    notification.on("show", () => log("Reminder notification shown."));
    notification.show();
  }

  /** One claim -> show -> acknowledge cycle. Never throws. */
  async function pollOnce() {
    if (inFlight) return { skipped: "busy" };
    if (!isReady()) return { skipped: "server-not-ready" };
    inFlight = true;
    try {
      const reply = await post("/due/claim", { client: "desktop" });
      if (!reply || reply.ok !== true) {
        const problem = (reply && reply.reason) || "unexpected reply";
        if (problem !== lastProblem) log(`Reminder claim refused: ${problem}`, "error");
        lastProblem = problem;
        return { skipped: "refused", reason: problem };
      }
      lastProblem = "";
      if (reply.attention && typeof reply.attention.count === "number") {
        onAttention(reply.attention.count);
      }
      if (!reply.claimId || !reply.toast) return { shown: 0 };
      show(reply.toast);
      // Acknowledge only after the notification was handed to the OS, so a
      // failure above leaves the claim to expire and be offered again.
      await post("/due/ack", { claimId: reply.claimId });
      return {
        shown: reply.notifications ? reply.notifications.length : 1,
        toast: reply.toast,
      };
    } catch (error) {
      const problem = error && error.message ? error.message : String(error);
      if (problem !== lastProblem) log(`Reminder poll failed: ${problem}`, "error");
      lastProblem = problem;
      return { skipped: "error", reason: problem };
    } finally {
      inFlight = false;
    }
  }

  return {
    pollOnce,
    start({ firstDelayMs = FIRST_POLL_DELAY_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
      this.stop();
      first = setTimeoutImpl(() => void pollOnce(), firstDelayMs);
      timer = setIntervalImpl(() => void pollOnce(), intervalMs);
    },
    stop() {
      if (first) clearTimeoutImpl(first);
      if (timer) clearIntervalImpl(timer);
      first = null;
      timer = null;
    },
  };
}

module.exports = {
  POLL_INTERVAL_MS,
  FIRST_POLL_DELAY_MS,
  DESKTOP_HEADER,
  readDesktopPrefs,
  attentionLabel,
  renderBadgeBitmap,
  createReminderPoller,
};
