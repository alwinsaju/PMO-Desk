const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, existsSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const displaySettings = require("./display-settings.cjs");
const launchConfig = require("./launch-config.cjs");
const pmoNotifier = require("./pmo-notifier.cjs");

// Windows toasts and the taskbar group are keyed by this id; it must match
// build.appId in package.json (the installer registers the same one).
const APP_USER_MODEL_ID = "com.aios.desktop";
app.setAppUserModelId(APP_USER_MODEL_ID);

// Hardware acceleration is a process-start decision in Chromium, so the saved
// choice (display-settings.cjs; written by the Settings toggle) is read here,
// synchronously, before the app is ready. OFF (the default) disables it.
const displayFile = displaySettings.settingsFilePath(app.getPath("userData"));
/** What this process was started with; the toggle only takes effect on restart. */
const launchedDisplay = displaySettings.readDisplaySettings(displayFile);
if (displaySettings.shouldDisableHardwareAcceleration(launchedDisplay)) {
  app.disableHardwareAcceleration();
}

const HOST = "127.0.0.1";
const PREFERRED_PORT = 3100;
const PORT_SPAN = 100;
const TASKS_ENGINE_START_TIMEOUT_MS = 60_000;
const SERVER_STOP_TIMEOUT_MS = 10_000;
const PORT_FREE_TIMEOUT_MS = 10_000;
const TASKS_ENGINE_URL =
  process.env.NEXT_PUBLIC_TASKS_ENGINE_URL?.trim() || "http://localhost:8000";
const OUTPUT_TAIL_LINES = 25;

let mainWindow;
let splashWindow;
let isQuitting = false;
let port;
let appUrl;

// PMO reminders (see pmo-notifier.cjs): the poller, the optional tray icon, and
// the "open this to-do" request a clicked notification leaves for the page.
let reminderPoller;
let tray;
let attentionCount = 0;
/** The page has registered its window.aiOsDesktop.onOpenTodo listener. */
let rendererReady = false;
let pendingOpen = null;
/** Skip the Tasks engine start/stop calls (they would touch the real engine):
 *  for testing the shell on its own, e.g. AI_OS_SKIP_TASKS_ENGINE=1. */
const skipTasksEngine = process.env.AI_OS_SKIP_TASKS_ENGINE === "1";
/** Where the Next server mirrors the "keep running in the tray" setting. */
const desktopPrefsFile = () => path.join(app.getPath("userData"), "desktop-prefs.json");

/**
 * How the UI server is launched (see launch-config.cjs): live-dev / live-build
 * run from the project folder so UI changes need no reinstall; bundled runs
 * the copy installed with the app. `mode` can change at startup when a live
 * mode falls back to bundled.
 */
let launch;

/**
 * The UI (Next) server we own.
 *   child:     the spawned process
 *   mode:      the mode it was started in
 *   ready:     true once it answered; a crash after that is offered a restart
 *   restarting: an intentional restart is in progress (exits are expected)
 *   output:    the last few lines it printed, for crash dialogs
 */
let ui = {
  child: undefined,
  mode: "bundled",
  ready: false,
  restarting: false,
  output: [],
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    // Hidden to the tray: launching AI OS again brings it back.
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch(showStartupFailure);
}

async function startDesktopApp() {
  launch = launchConfig.resolveLaunchConfig({
    exeDir: path.dirname(process.execPath),
    desktopDir: __dirname,
    packaged: app.isPackaged,
  });
  desktopLog(`Starting AI OS from ${app.getAppPath()}.`);
  for (const note of launch.notes) {
    desktopLog(note);
  }
  if (launch.fallbackReason) {
    desktopLog(`${launch.fallbackReason} Using the bundled app.`);
  }
  desktopLog(`Launch mode: ${launch.mode} (${launchConfig.describeMode(launch)}).`);

  port = await findAvailablePort();
  appUrl = `http://${HOST}:${port}`;

  if (launchConfig.isLiveMode(launch.mode)) {
    showSplash();
  }
  await startUiServerWithFallback();
  await startTasksEngine();
  buildMenu();
  createWindow();
  closeSplash();
  startReminders();
}

// ---------------------------------------------------------------------------
// UI server lifecycle
// ---------------------------------------------------------------------------

/** Start the UI server in `launch.mode`; if a live mode cannot come up in
 *  time (or dies), log why and fall back to the bundled app. */
async function startUiServerWithFallback() {
  if (launchConfig.isLiveMode(launch.mode)) {
    try {
      await startUiServer(launch.mode);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      desktopLog(
        `Live mode (${launch.mode}) failed: ${reason} Falling back to the bundled app.`,
        "error",
      );
      launch = {
        ...launch,
        mode: "bundled",
        fallbackReason: `${launch.mode} failed to start: ${reason}`,
      };
      await stopUiServer();
      // The failed server may still hold its port for a moment; take a fresh one.
      port = await findAvailablePort();
      appUrl = `http://${HOST}:${port}`;
    }
  }
  await startUiServer("bundled");
}

async function startUiServer(mode) {
  const live = launchConfig.isLiveMode(mode);
  const root = live ? launch.projectDir : app.getAppPath();
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const args = launchConfig.nextServerArgs({
    mode,
    nextCli,
    host: HOST,
    port,
    scripts: launchConfig.readProjectScripts(root),
  });

  desktopLog(`Starting Next.js (${mode}) in ${root}: next ${args.slice(1).join(" ")}`);
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: false,
    env: {
      ...process.env,
      AI_OS_DESKTOP_MODE: "1",
      // PMO To-Do keeps its records here: outside the install dir and OneDrive.
      AI_OS_PMO_DATA_DIR: path.join(app.getPath("userData"), "pmo"),
      // The server mirrors the tray setting here for this shell to read.
      AI_OS_DESKTOP_PREFS_FILE: desktopPrefsFile(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: mode === "live-dev" ? "development" : "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  ui = { child, mode, ready: false, restarting: false, output: [] };

  const record = (data, level) => {
    const text = data.toString().trim();
    if (!text) {
      return;
    }
    desktopLog(text, level);
    ui.output.push(...text.split(/\r?\n/));
    ui.output = ui.output.slice(-OUTPUT_TAIL_LINES);
  };
  child.stdout.on("data", (data) => record(data, "log"));
  child.stderr.on("data", (data) => record(data, "error"));
  child.once("error", (error) => {
    child.spawnFailure = error;
    if (!isQuitting && ui.child === child && ui.ready) {
      void offerUiRestart(`The AI OS server could not run: ${error.message}`);
    }
  });
  child.once("exit", (code) => {
    // Before `ready`, waitForServer sees the exit and throws; during an
    // intentional stop/restart the exit is expected.
    if (isQuitting || ui.child !== child || !ui.ready || ui.restarting) {
      return;
    }
    void offerUiRestart(`The AI OS server exited unexpectedly (code ${code}).`);
  });

  await waitForServer(
    child,
    launchConfig.startTimeoutMs(mode),
    mode === "live-dev" ? 15_000 : 1_000,
  );
  ui.ready = true;
}

/** Stop the spawned UI server and everything it started (dev mode forks a
 *  worker, and the owned engine is its child). Resolves when gone. */
async function stopUiServer() {
  const child = ui.child;
  if (!child) {
    return;
  }
  const wasRestarting = ui.restarting;
  ui.restarting = true;
  try {
    await stopProcess(child);
  } finally {
    ui.restarting = wasRestarting;
  }
}

async function waitForServer(child, timeoutMs, probeTimeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.spawnFailure) {
      throw new Error(
        `The AI OS server could not be started: ${child.spawnFailure.message}`,
      );
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`The AI OS server exited with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(appUrl, {
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The server has not finished binding its loopback port yet.
    }

    await delay(250);
  }

  throw new Error(`AI OS did not start within ${timeoutMs / 1000} seconds.`);
}

/** The UI server died (or could not run) after it was up: tell the user and
 *  offer a restart instead of leaving a blank window. */
async function offerUiRestart(message) {
  desktopLog(message, "error");
  const tail = ui.output.slice(-8).join("\n");
  const options = {
    type: "error",
    title: "AI OS server stopped",
    message,
    detail: tail ? `Last output:\n${tail}` : undefined,
    buttons: ["Restart UI server", "Quit AI OS"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = await showMessage(options);
  if (response === 0) {
    await restartUiServer({ confirmIfBusy: false });
  } else {
    app.quit();
  }
}

/**
 * Developer > Restart UI server. Stops the UI server (which also stops the
 * engine it owns, since the engine is its child), starts it again in the
 * same mode on the same port (the web origin, and with it saved settings,
 * stays the same), re-launches the engine and reloads the window.
 */
async function restartUiServer({ confirmIfBusy }) {
  if (ui.restarting || isQuitting) {
    return;
  }

  if (confirmIfBusy) {
    const busy = await listBusyTasks();
    const { response } = await showMessage({
      type: busy.length ? "warning" : "question",
      title: "Restart UI server",
      message: "Restart the AI OS UI server?",
      detail:
        (busy.length
          ? `WARNING: ${busy.length} task(s) are not idle (${busy.join(", ")}). ` +
            "Restarting also restarts the engine and STOPS those runs.\n\n"
          : "") +
        "The engine (Tasks engine) is restarted together with the UI server. " +
        "The window reloads when it is back.",
      buttons: ["Cancel", busy.length ? "Restart and stop runs" : "Restart"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1) {
      return;
    }
  }

  const previousMode = ui.mode;
  ui.restarting = true;
  desktopLog("Restarting the UI server.");
  try {
    await requestServiceShutdown();
    await stopProcess(ui.child);
    await waitForPortFree(port);

    try {
      await startUiServer(previousMode);
    } catch (error) {
      if (!launchConfig.isLiveMode(previousMode)) {
        throw error;
      }
      desktopLog(
        `Live mode (${previousMode}) failed to restart: ${
          error instanceof Error ? error.message : String(error)
        } Falling back to the bundled app.`,
        "error",
      );
      launch = { ...launch, mode: "bundled", fallbackReason: "restart failed" };
      await stopProcess(ui.child);
      await waitForPortFree(port);
      await startUiServer("bundled");
    }

    await startTasksEngine();
    buildMenu();
    updateWindowTitle();
    if (mainWindow) {
      void mainWindow.loadURL(appUrl);
    }
    desktopLog("UI server restarted.");
  } catch (error) {
    ui.restarting = false;
    desktopLog(
      `Restart failed: ${error instanceof Error ? error.stack || error.message : String(error)}`,
      "error",
    );
    await offerUiRestart(
      `The UI server could not be restarted: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    ui.restarting = false;
  }
}

/** Read-only: names of tasks that are not resting. Empty if unreachable. */
async function listBusyTasks() {
  try {
    const response = await fetch(`${TASKS_ENGINE_URL}/tasks`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return [];
    }
    return launchConfig.busyTaskNames(await response.json());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tasks engine (started and stopped through the UI server's routes)
// ---------------------------------------------------------------------------

async function startTasksEngine() {
  if (skipTasksEngine) {
    desktopLog("AI_OS_SKIP_TASKS_ENGINE=1: not starting Tasks engine.");
    return;
  }
  desktopLog("Starting Tasks engine.");
  const response = await fetch(`${appUrl}/api/tasks-engine/start`, {
    method: "POST",
    signal: AbortSignal.timeout(TASKS_ENGINE_START_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Tasks engine start request failed: ${response.status}.`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.reason || "Tasks engine could not start.");
  }
  desktopLog("Tasks engine is ready.");
}

// ---------------------------------------------------------------------------
// Windows and menu
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: launchConfig.windowTitle(launch),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // window.aiOsDesktop: reminders click-through and badge (preload.cjs).
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Keep the mode visible in the title: the page's own <title> ("AI OS")
  // would otherwise replace it on every navigation.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    updateWindowTitle();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) {
      return { action: "allow" };
    }
    // Only web links and mailto: (the PMO "open as unsent mail draft" link,
    // which just opens a compose window in the user's own mail program) are
    // handed to the OS; any other scheme is dropped.
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // "Keep running in the tray" (a setting, off by default): closing the window
  // hides it so reminders keep firing. Off, closing behaves as it always did
  // (window-all-closed quits the app).
  mainWindow.on("close", (event) => {
    if (
      isQuitting ||
      !pmoNotifier.readDesktopPrefs(desktopPrefsFile()).keepRunningInTray
    ) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    ensureTray();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    rendererReady = false;
  });
  // A new page load has not registered its listener yet.
  mainWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) rendererReady = false;
    },
  );
  void mainWindow.loadURL(appUrl);
}

// ---------------------------------------------------------------------------
// PMO reminders: poller, notification click, badge, optional tray
// ---------------------------------------------------------------------------

function startReminders() {
  reminderPoller = pmoNotifier.createReminderPoller({
    getBaseUrl: () => appUrl,
    isReady: () => Boolean(appUrl) && ui.ready && !ui.restarting && !isQuitting,
    Notification,
    onOpenTodo: openTodoFromNotification,
    onAttention: applyBadge,
    log: desktopLog,
  });
  reminderPoller.start({
    firstDelayMs: Number(process.env.AI_OS_REMINDER_FIRST_MS) || undefined,
    intervalMs: Number(process.env.AI_OS_REMINDER_POLL_MS) || undefined,
  });
}

/** Bring the window back (from minimised, or hidden in the tray). */
function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

/** A clicked reminder: show the window and have the page open the PMO app. If
 *  the page has not registered yet, the request waits for it. */
function openTodoFromNotification(todoId) {
  showMainWindow();
  if (rendererReady && mainWindow) {
    mainWindow.webContents.send("pmo:open-todo", todoId);
  } else {
    pendingOpen = { todoId };
  }
}

/** Taskbar overlay badge (Windows) and the tray tooltip. */
function applyBadge(count) {
  attentionCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const label = pmoNotifier.attentionLabel(attentionCount);
  try {
    if (mainWindow && typeof mainWindow.setOverlayIcon === "function") {
      const overlay =
        attentionCount > 0
          ? nativeImage.createFromBitmap(
              pmoNotifier.renderBadgeBitmap(attentionCount).buffer,
              { width: 32, height: 32 },
            )
          : null;
      mainWindow.setOverlayIcon(overlay, label);
    }
    if (tray) {
      tray.setToolTip(label ? `AI OS - ${label}` : "AI OS");
    }
  } catch (error) {
    desktopLog(`Could not update the badge: ${error && error.message}`, "error");
  }
}

function ensureTray() {
  if (tray) {
    return;
  }
  try {
    const icon = nativeImage
      .createFromPath(path.join(__dirname, "icon.png"))
      .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("AI OS");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open AI OS", click: showMainWindow },
        { type: "separator" },
        // A full quit: before-quit stops the servers, including the Ollama
        // runtime this app started (stopAiRuntime), exactly like File > Quit.
        { label: "Quit", click: () => app.quit() },
      ]),
    );
    tray.on("click", showMainWindow);
    applyBadge(attentionCount);
    desktopLog("Tray icon created (keep running in the tray is on).");
  } catch (error) {
    // Without a tray there is no way back to a hidden window: show it again
    // rather than leave AI OS running invisibly.
    desktopLog(`Could not create the tray icon: ${error && error.message}`, "error");
    tray = undefined;
    if (mainWindow) mainWindow.show();
  }
}

/** Only our own window may talk to these handlers. */
function isFromMainWindow(event) {
  return Boolean(
    mainWindow &&
    event.sender === mainWindow.webContents &&
    event.sender.getURL().startsWith(appUrl),
  );
}

ipcMain.on("pmo:set-badge", (event, count) => {
  if (isFromMainWindow(event) && typeof count === "number") {
    applyBadge(count);
  }
});

ipcMain.handle("pmo:renderer-ready", (event) => {
  if (!isFromMainWindow(event)) {
    return null;
  }
  rendererReady = true;
  const pending = pendingOpen;
  pendingOpen = null;
  return pending;
});

// ---------------------------------------------------------------------------
// Display settings: hardware acceleration (needs a restart) + rich/lean effects
// ---------------------------------------------------------------------------

/** The page's visual mode follows the saved setting right away (CSS), while the
 *  GPU choice only applies after a restart. Sender identity only: the preload
 *  asks while the page is still loading, and this reveals nothing sensitive. */
ipcMain.on("display:get-mode", (event) => {
  event.returnValue =
    mainWindow && event.sender === mainWindow.webContents
      ? displaySettings.fxModeFor(displaySettings.readDisplaySettings(displayFile))
      : "lean";
});

function displayState() {
  return {
    saved: displaySettings.readDisplaySettings(displayFile).hardwareAcceleration,
    ...displaySettings.describeGpu({
      featureStatus: app.getGPUFeatureStatus(),
      launchedWithGpu:
        !displaySettings.shouldDisableHardwareAcceleration(launchedDisplay),
    }),
  };
}

ipcMain.handle("display:get-state", (event) =>
  isFromMainWindow(event) ? displayState() : null,
);

ipcMain.handle("display:set-hardware-acceleration", (event, enabled) => {
  if (!isFromMainWindow(event) || typeof enabled !== "boolean") {
    return null;
  }
  try {
    displaySettings.writeDisplaySettings(displayFile, { hardwareAcceleration: enabled });
    desktopLog(
      `Hardware acceleration set to ${enabled ? "ON" : "OFF"} (applies after a restart).`,
    );
  } catch (error) {
    desktopLog(
      `Could not save the hardware acceleration setting: ${error && error.message}`,
      "error",
    );
    return { ...displayState(), error: "Could not save the setting." };
  }
  return displayState();
});

/** "Restart to apply": relaunch the app. The normal quit path runs first (it
 *  stops the UI server, the Tasks engine this app owns and the AI
 *  runtime), then the new instance starts. Warns first if a task is running. */
ipcMain.handle("display:relaunch", async (event) => {
  if (!isFromMainWindow(event) || isQuitting) {
    return false;
  }
  const busy = skipTasksEngine ? [] : await listBusyTasks();
  if (busy.length) {
    const { response } = await showMessage({
      type: "warning",
      title: "Restart AI OS",
      message: "Restart AI OS to apply the display setting?",
      detail: `WARNING: ${busy.length} task(s) are not idle (${busy.join(", ")}). Restarting STOPS those runs.`,
      buttons: ["Cancel", "Restart and stop runs"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1) {
      return false;
    }
  }
  desktopLog("Relaunching AI OS to apply the display setting.");
  // Without this the new instance can lose the single-instance race against
  // this one while it is still shutting down.
  app.releaseSingleInstanceLock();
  app.relaunch();
  app.quit();
  return true;
});

function updateWindowTitle() {
  if (mainWindow) {
    mainWindow.setTitle(launchConfig.windowTitle(launch));
  }
}

/** A tiny "starting" window: live-dev can take a while on a cold compile. */
function showSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 130,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    title: "AI OS",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const modeLine = launchConfig
    .describeMode(launch)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  const html =
    '<body style="margin:0;display:flex;flex-direction:column;justify-content:center;align-items:center;' +
    'height:100vh;font-family:Segoe UI,sans-serif;background:#1c1c1e;color:#f2f2f7">' +
    '<div style="font-size:18px">Starting AI OS...</div>' +
    `<div style="font-size:12px;opacity:.6;margin-top:8px">${modeLine}</div></body>`;
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.on("closed", () => {
    splashWindow = undefined;
  });
}

function closeSplash() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = undefined;
  }
}

function buildMenu() {
  const projectFolder =
    launch.projectDir && existsSync(launch.projectDir)
      ? launch.projectDir
      : app.getAppPath();
  const template = [
    { label: "File", submenu: [{ role: "quit" }] },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Developer",
      submenu: [
        { label: `Mode: ${launchConfig.describeMode(launch)}`, enabled: false },
        { type: "separator" },
        {
          label: "Restart UI server",
          click: () => void restartUiServer({ confirmIfBusy: true }),
        },
        { label: "Open project folder", click: () => void shell.openPath(projectFolder) },
        {
          label: "Open logs folder",
          click: () => void shell.openPath(app.getPath("userData")),
        },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "About AI OS", click: showAbout }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  const lines = [
    `Version ${app.getVersion()}`,
    `Mode: ${launchConfig.describeMode(launch)}`,
    `UI server: ${appUrl}`,
    `App files: ${app.getAppPath()}`,
  ];
  if (launch.fallbackReason) {
    lines.push("", `Fell back to bundled: ${launch.fallbackReason}`);
  }
  void showMessage({
    type: "info",
    title: "About AI OS",
    message: "AI OS",
    detail: lines.join("\n"),
    buttons: ["OK"],
    noLink: true,
  });
}

app.on("window-all-closed", () => app.quit());

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  if (reminderPoller) {
    reminderPoller.stop();
  }
  if (tray) {
    tray.destroy();
    tray = undefined;
  }
  void stopServices().finally(() => app.exit(0));
});

async function stopServices() {
  const child = ui.child;
  if (!child || child.exitCode !== null) {
    return;
  }

  await requestServiceShutdown();
  await stopProcess(child);
}

/** Ask the UI server to stop the engine and the local AI runtime it owns. */
async function requestServiceShutdown() {
  // A dev server may need to compile these routes on first use.
  const timeout = ui.mode === "live-dev" ? 20_000 : 5_000;
  try {
    if (!skipTasksEngine) {
      const response = await fetch(`${appUrl}/api/tasks-engine/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        throw new Error(`Tasks engine stop request failed: ${response.status}.`);
      }
    }
  } catch (error) {
    desktopLog(
      `Could not request a clean Tasks engine shutdown: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
  }

  await stopAiRuntime();
}

// The AI runtime (Ollama) is started by the Next server itself
// (src/instrumentation.ts); on quit, ask it to stop the Ollama it owns. A
// reused external Ollama is left running by that route.
async function stopAiRuntime() {
  try {
    await fetch(`${appUrl}/api/ai/runtime/stop`, {
      method: "POST",
      headers: { "x-ai-os-desktop": "1" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    desktopLog(
      `Could not request an AI runtime shutdown: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "error",
    );
  }
}

/** Kill `child` and its descendants (a dev server forks a worker; on Windows
 *  `child.kill()` alone would orphan it and keep the port busy). */
function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, SERVER_STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    killProcessTree(child);
  });
}

function killProcessTree(child) {
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn("taskkill", ["/PID", `${child.pid}`, "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      killer.once("error", () => child.kill());
      return;
    } catch {
      // Fall through to a plain kill.
    }
  }
  child.kill();
}

function showStartupFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error && error.stack ? error.stack : message;
  desktopLog(details, "error");
  dialog.showErrorBox("AI OS could not start", message);
  isQuitting = true;
  closeSplash();
  void stopServices().finally(() => app.exit(1));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showMessage(options) {
  return mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPortFree(candidatePort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen(candidatePort, HOST, () => {
      probe.close(() => resolve(true));
    });
  });
}

function findAvailablePort() {
  return launchConfig.pickPort(isPortFree, PREFERRED_PORT, PORT_SPAN);
}

async function waitForPortFree(candidatePort) {
  const deadline = Date.now() + PORT_FREE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isPortFree(candidatePort)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Port ${candidatePort} is still in use after stopping the UI server.`);
}

function desktopLog(message, level = "log") {
  const line = `[${new Date().toISOString()}] ${message}`;
  console[level](line);
  try {
    appendFileSync(path.join(app.getPath("userData"), "desktop.log"), `${line}\n`);
  } catch {
    // Logging must never take the app down.
  }
}
