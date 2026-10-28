// Exposes a tiny, fixed API to the page as window.aiOsDesktop (contextIsolation
// is on and the renderer is sandboxed, so this file may only use `electron`).
// The page uses it to (a) learn it is inside the desktop app, so it does not
// poll for reminders itself, (b) open a to-do when a reminder notification is
// clicked, (c) report how many items need attention, and (d) read/change the
// "Hardware acceleration" display setting and restart to apply it, and (e) pick a
// folder for the setup screen. No generic IPC, no
// Node, no file access is handed over; main.cjs also checks who is asking.
const { contextBridge, ipcRenderer } = require("electron");

// The saved visual mode ("rich" with hardware acceleration ON, else "lean"),
// read synchronously so the page's init script can set <html data-fx> before
// the first paint. Falls back to "lean" if the shell does not answer.
let displayMode = "lean";
try {
  displayMode = ipcRenderer.sendSync("display:get-mode") === "rich" ? "rich" : "lean";
} catch {
  displayMode = "lean";
}

contextBridge.exposeInMainWorld("aiOsDesktop", {
  isDesktop: true,

  /** "rich" | "lean": the saved display mode at page load (see src/lib/displayFx.ts). */
  displayMode,

  display: {
    /** { saved, launchedWithGpu, compositing, gpuCompositing, noHardwareAcceleration } | null */
    getState: () => ipcRenderer.invoke("display:get-state"),
    /** Saves the setting (applies to the GPU after a restart); resolves to the new state. */
    setHardwareAcceleration: (enabled) =>
      ipcRenderer.invoke("display:set-hardware-acceleration", enabled === true),
    /** Relaunches AI OS (asks first if a task is running); resolves true if it is restarting. */
    relaunch: () => ipcRenderer.invoke("display:relaunch"),
  },

  /** Opens the system folder picker for the setup screen; resolves to the
   *  chosen folder's path, or null if cancelled. */
  chooseFolder: () => ipcRenderer.invoke("setup:choose-folder"),

  /** callback(todoId | null) when a reminder is clicked; returns an unsubscribe.
   *  A click that arrived before the page was ready is delivered right away. */
  onOpenTodo(callback) {
    if (typeof callback !== "function") return () => {};
    let active = true;
    const deliver = (todoId) => {
      if (active) callback(typeof todoId === "string" ? todoId : null);
    };
    const handler = (_event, todoId) => deliver(todoId);
    ipcRenderer.on("pmo:open-todo", handler);
    ipcRenderer
      .invoke("pmo:renderer-ready")
      .then((pending) => {
        if (pending && typeof pending === "object") deliver(pending.todoId);
      })
      .catch(() => {});
    return () => {
      active = false;
      ipcRenderer.removeListener("pmo:open-todo", handler);
    };
  },

  /** Taskbar overlay and tray tooltip; 0 clears it. */
  setBadge(count) {
    const n = Number(count);
    ipcRenderer.send(
      "pmo:set-badge",
      Number.isFinite(n) ? Math.max(0, Math.min(999, Math.floor(n))) : 0,
    );
  },
});
