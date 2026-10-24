// Exposes a tiny, fixed API to the page as window.aiOsDesktop (contextIsolation
// is on and the renderer is sandboxed, so this file may only use `electron`).
// The page uses it to (a) learn it is inside the desktop app, so it does not
// poll for reminders itself, (b) open a to-do when a reminder notification is
// clicked, and (c) report how many items need attention. No generic IPC, no
// Node, no file access is handed over; main.cjs also checks who is asking.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiOsDesktop", {
  isDesktop: true,

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
