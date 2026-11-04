const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  session,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { existsSync } = fs;
const { createLogWriter } = require("./log-rotate.cjs");
const net = require("node:net");
const path = require("node:path");
const displaySettings = require("./display-settings.cjs");
const launchConfig = require("./launch-config.cjs");
const childEnv = require("./child-env.cjs");
const exportPicker = require("./export-picker.cjs");
const platformShell = require("./platform-shell.cjs");
const { warmDevRoutes } = require("./dev-warmup.cjs");
const { describeExitCode } = require("./exit-code.cjs");
const portRetry = require("./port-retry.cjs");
const pmoNotifier = require("./pmo-notifier.cjs");
const recoveryPolicy = require("./renderer-recovery.cjs");
const singleFlight = require("./single-flight.cjs");
const trayPolicy = require("./tray-policy.cjs");
const urlGuard = require("./url-guard.cjs");

// Windows toasts and the taskbar group are keyed by this id; it must match
// build.appId in package.json (the installer registers the same one). Kept as
// com.aios.desktop on purpose: a different id would make the installer treat PMO Desk as a
// new app instead of upgrading the existing install.
const APP_USER_MODEL_ID = "com.aios.desktop";
app.setAppUserModelId(APP_USER_MODEL_ID);

// The user-data folder keeps its old name (%APPDATA%\ai-os) so existing data is found; see
// user-data.cjs. This has to run before anything reads userData.
const { applyUserDataPin } = require("./user-data.cjs");
applyUserDataPin(app);
app.setName("PMO Desk");

// Hardware acceleration is a process-start decision in Chromium, so the saved
// choice (display-settings.cjs; written by the Settings toggle) is read here,
// synchronously, before the app is ready. ON is the default; OFF disables it.
const displayFile = displaySettings.settingsFilePath(app.getPath("userData"));
/** What this process was started with; the toggle only takes effect on restart. */
const launchedDisplay = displaySettings.readDisplaySettings(displayFile);
if (displaySettings.shouldDisableHardwareAcceleration(launchedDisplay)) {
  app.disableHardwareAcceleration();
}

const HOST = "127.0.0.1";
const PREFERRED_PORT = 3100;
const PORT_SPAN = 100;
const TASKS_ENGINE_START_TIMEOUT_MS = 90_000;
const SERVER_STOP_TIMEOUT_MS = 10_000;
const PORT_FREE_TIMEOUT_MS = 10_000;
const OUTPUT_TAIL_LINES = 25;

let mainWindow;
let splashWindow;
let isQuitting = false;
let port;
let appUrl;
/** Timestamps of recent renderer crashes (crash-loop detection) and whether the
 *  "not responding" dialog is already up. */
let rendererGoneTimes = [];
let unresponsiveDialogOpen = false;
/** Windows is signing out / shutting down (set by the session events below). */
let sessionEnding = false;
let sessionEndConfirmed = false;
let tlsOverrideLogged = false;

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
 *   output:    the last few lines it printed, for crash dialogs
 * (An intentional stop/restart is tracked by `uiRestarting` / `restartGate`
 * below: they must outlive this object, which startUiServer replaces.)
 */
let ui = {
  child: undefined,
  mode: "bundled",
  ready: false,
  output: [],
};
/** An intentional stop/restart is under way (child exits are expected). */
let uiRestarting = false;
/** Restarts run one at a time; a second request joins the one in flight. */
const restartGate = singleFlight.createSingleFlight();

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
    // Hidden to the tray: launching PMO Desk again brings it back.
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
  desktopLog(`Starting PMO Desk from ${app.getAppPath()}.`);
  for (const note of launch.notes) {
    desktopLog(note);
  }
  if (launch.fallbackReason) {
    desktopLog(`${launch.fallbackReason} Using the bundled app.`);
  }
  desktopLog(`Launch mode: ${launch.mode} (${launchConfig.describeMode(launch)}).`);

  port = await findAvailablePort();
  appUrl = `http://${HOST}:${port}`;

  installPermissionHandlers();
  // 'shutdown' is emitted on macOS/Linux only; Windows uses the window's
  // query-session-end / session-end (createWindow).
  powerMonitor.on("shutdown", () => {
    markSessionEnding();
    app.quit();
  });
  showSplash();
  await startUiServerWithFallback();
  // The engine is optional for the shell: a slow or failed start must not keep the window
  // (and the Setup screen that diagnoses it) from opening. The Tasks app re-requests a start.
  void startTasksEngine().catch((error) => {
    desktopLog(
      `Tasks engine did not start: ${error instanceof Error ? error.message : error}`,
      "error",
    );
  });
  buildMenu();
  createWindow();
  closeSplash();
  startReminders();
  if (launch.mode === "live-dev") {
    // `next dev` compiles each route on first use; do that now, in the background.
    void warmDevRoutes({ baseUrl: appUrl }).then(({ warmed, failed }) =>
      desktopLog(`Warmed ${warmed} dev routes${failed ? ` (${failed} failed)` : ""}.`),
    );
  }
}

// ---------------------------------------------------------------------------
// UI server lifecycle
// ---------------------------------------------------------------------------

/** Start the UI server in `launch.mode`; if a live mode cannot come up in
 *  time (or dies), log why and fall back to the bundled app. */
async function startUiServerWithFallback() {
  if (launchConfig.isLiveMode(launch.mode)) {
    try {
      await startUiServerRetryingPort(launch.mode);
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
  await startUiServerRetryingPort("bundled");
}

/** startUiServer, retried once on a fresh port when its port was taken or it
 *  died before answering (port-retry.cjs): another instance may hold the port. */
async function startUiServerRetryingPort(mode) {
  try {
    await startUiServer(mode);
  } catch (error) {
    const retry = portRetry.shouldRetryOnFreshPort({
      output: ui.output,
      exitedBeforeReady: Boolean(error && error.exitedBeforeReady),
    });
    if (!retry) {
      throw error;
    }
    const failedPort = port;
    desktopLog(
      `The UI server could not start on port ${failedPort}: ${
        error instanceof Error ? error.message : String(error)
      } Retrying once on a fresh port.`,
      "error",
    );
    await stopUiServer();
    port = await launchConfig.pickPort(
      async (candidate) => candidate !== failedPort && (await isPortFree(candidate)),
      PREFERRED_PORT,
      PORT_SPAN,
    );
    appUrl = `http://${HOST}:${port}`;
    desktopLog(`Retrying the UI server on port ${port}.`);
    await startUiServer(mode);
  }
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
    env: uiServerEnv(mode),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  ui = { child, mode, ready: false, output: [] };

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
      void offerUiRestart(`The PMO Desk server could not run: ${error.message}`);
    }
  });
  child.once("exit", (code) => {
    // Before `ready`, waitForServer sees the exit and throws; during an
    // intentional stop/restart the exit is expected.
    if (isQuitting || ui.child !== child || !ui.ready || uiRestarting) {
      return;
    }
    void offerUiRestart(
      `The PMO Desk server exited unexpectedly (code ${describeExitCode(code)}).`,
    );
  });

  await waitForServer(
    child,
    launchConfig.startTimeoutMs(mode),
    mode === "live-dev" ? 15_000 : 1_000,
  );
  ui.ready = true;
}

/** The UI server's environment, without the TLS-verification override (child-env.cjs). */
function uiServerEnv(mode) {
  const { env, removed } = childEnv.sanitizeChildEnv({
    ...process.env,
    AI_OS_DESKTOP_MODE: "1",
    AI_OS_APP_VERSION: app.getVersion(),
    // PMO To-Do keeps its records here: outside the install dir and OneDrive.
    AI_OS_PMO_DATA_DIR: path.join(app.getPath("userData"), "pmo"),
    // The server mirrors the tray setting here for this shell to read.
    AI_OS_DESKTOP_PREFS_FILE: desktopPrefsFile(),
    ...tasksEngineEnv(),
    ...childEnv.proxyEnv(process.env),
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: mode === "live-dev" ? "development" : "production",
  });
  if (removed.length && !tlsOverrideLogged) {
    tlsOverrideLogged = true;
    desktopLog(
      `${childEnv.TLS_OVERRIDE_NAME} was set in the environment and was removed for the UI server ` +
        "(certificate checks stay on). For a corporate proxy, set NODE_EXTRA_CA_CERTS to its CA file instead.",
    );
  }
  return env;
}

/**
 * What the UI server needs to start the Tasks engine from an installed app: the
 * Python bundled in resources/python, and a data folder under userData so the
 * install folder stays read-only and task inputs, outputs and run history
 * survive a reinstall (tasks-engine/workcopy.py). Unpackaged runs (`pnpm
 * desktop`) use the repo's own Python and run tasks in place. Either can be
 * overridden from the environment.
 */
function tasksEngineEnv() {
  if (!app.isPackaged) {
    return {};
  }
  return {
    AI_OS_TASKS_PYTHON:
      process.env.AI_OS_TASKS_PYTHON ||
      path.join(process.resourcesPath, "python", "pythonw.exe"),
    AI_OS_TASKS_DATA_DIR:
      process.env.AI_OS_TASKS_DATA_DIR ||
      path.join(app.getPath("userData"), "tasks-engine"),
  };
}

/** Stop the spawned UI server and everything it started (dev mode forks a
 *  worker, and the owned engine is its child). Resolves when gone. */
async function stopUiServer() {
  const child = ui.child;
  if (!child) {
    return;
  }
  const wasRestarting = uiRestarting;
  uiRestarting = true;
  try {
    await stopProcess(child);
  } finally {
    uiRestarting = wasRestarting;
  }
}

async function waitForServer(child, timeoutMs, probeTimeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.spawnFailure) {
      throw new Error(
        `The PMO Desk server could not be started: ${child.spawnFailure.message}`,
      );
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw Object.assign(
        new Error(
          `The PMO Desk server exited with code ${describeExitCode(child.exitCode)}.`,
        ),
        {
          exitedBeforeReady: true,
        },
      );
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

  throw new Error(`PMO Desk did not start within ${timeoutMs / 1000} seconds.`);
}

/** The UI server died (or could not run) after it was up: tell the user and
 *  offer a restart instead of leaving a blank window. */
async function offerUiRestart(message) {
  desktopLog(message, "error");
  const tail = ui.output.slice(-8).join("\n");
  const options = {
    type: "error",
    title: "PMO Desk server stopped",
    message,
    detail: tail ? `Last output:\n${tail}` : undefined,
    buttons: ["Restart UI server", "Quit PMO Desk"],
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
 * stays the same), re-launches the engine and reloads the window. A second
 * request while one is in flight joins it rather than starting another.
 */
async function restartUiServer({ confirmIfBusy }) {
  if (isQuitting) {
    return;
  }
  const { joined, result } = restartGate.run(() => runUiRestart({ confirmIfBusy }));
  if (joined) {
    desktopLog("A UI server restart is already in progress; ignoring the extra request.");
    await result;
    return;
  }
  const failure = await result;
  // Offered only after the gate is free again: the dialog's own restart must be allowed.
  if (failure) {
    await offerUiRestart(failure);
  }
}

/** Resolves to a failure message, or undefined when restarted (or cancelled). */
async function runUiRestart({ confirmIfBusy }) {
  if (confirmIfBusy) {
    const busy = await listBusyTasks();
    const { response } = await showMessage({
      type: busy.length ? "warning" : "question",
      title: "Restart UI server",
      message: "Restart the PMO Desk UI server?",
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
  uiRestarting = true;
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
    return undefined;
  } catch (error) {
    desktopLog(
      `Restart failed: ${error instanceof Error ? error.stack || error.message : String(error)}`,
      "error",
    );
    return `The UI server could not be restarted: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    uiRestarting = false;
  }
}

/** Read-only: names of tasks that are not resting. Empty if unreachable. */
async function listBusyTasks() {
  try {
    // The engine's port is picked at launch; ask the UI server where it is.
    const config = await fetch(`${appUrl}/api/tasks-engine/config`, {
      signal: AbortSignal.timeout(2_000),
    });
    const { url } = config.ok ? await config.json() : {};
    if (!url) {
      return [];
    }
    const response = await fetch(`${url}/tasks`, {
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
    icon: path.join(__dirname, "icon.ico"),
    title: launchConfig.windowTitle(launch),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // window.aiOsDesktop: reminders click-through and badge (preload.cjs).
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Keep the mode visible in the title: the page's own <title> ("PMO Desk")
  // would otherwise replace it on every navigation.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    updateWindowTitle();
  });
  // Only web links and mailto: (the PMO "open as unsent mail draft" link) are
  // handed to the OS; any other scheme is dropped (url-guard.cjs).
  const routeUrl = (url) => {
    const verdict = urlGuard.classifyNavigation(url, appUrl);
    if (verdict === "external") {
      void shell.openExternal(url);
    } else if (verdict === "deny") {
      desktopLog(
        `Blocked a link with an unsupported address: ${String(url).slice(0, 80)}`,
      );
    }
    return verdict;
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) =>
    routeUrl(url) === "allow" ? { action: "allow" } : { action: "deny" },
  );
  // The window never leaves the app origin: other addresses open in the OS.
  mainWindow.webContents.on("will-navigate", (event) => {
    if (routeUrl(event.url) !== "allow") {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    void handleRendererGone(details);
  });
  mainWindow.on("unresponsive", () => void handleWindowUnresponsive());
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // "Keep running in the tray" (a setting, off by default): closing the window
  // hides it so reminders keep firing. Off, closing behaves as it always did
  // (window-all-closed quits the app). Never while quitting or while Windows is
  // signing out / shutting down, or the window would block the session end.
  mainWindow.on("close", (event) => {
    if (
      !trayPolicy.shouldHideToTray({
        isQuitting,
        sessionEnding,
        keepRunningInTray:
          pmoNotifier.readDesktopPrefs(desktopPrefsFile()).keepRunningInTray,
      })
    ) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    ensureTray();
  });
  // Windows: query-session-end is the ask, session-end the point of no return.
  mainWindow.on("query-session-end", () => {
    markSessionEnding();
    // If the sign-out is vetoed no session-end follows; go back to normal.
    const reset = setTimeout(() => {
      if (!sessionEndConfirmed) sessionEnding = false;
    }, trayPolicy.SESSION_QUERY_GRACE_MS);
    reset.unref();
  });
  mainWindow.on("session-end", () => {
    sessionEndConfirmed = true;
    markSessionEnding();
    app.quit();
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

/** The OS is ending the session: stop hiding to the tray so close proceeds. */
function markSessionEnding() {
  if (!sessionEnding) {
    desktopLog("The OS session is ending; the window will close normally.");
  }
  sessionEnding = true;
}

/** The page's renderer died: a blank window is a dead end, so offer a reload. */
async function handleRendererGone(details) {
  const reason = details && details.reason;
  desktopLog(
    `The window's renderer process is gone (reason: ${reason}, exit code: ${details && details.exitCode}).`,
    reason === "clean-exit" ? "log" : "error",
  );
  if (isQuitting) {
    return;
  }
  rendererGoneTimes = recoveryPolicy.recordCrash(rendererGoneTimes, Date.now());
  const decision = recoveryPolicy.decideRendererGone({
    reason,
    recentCrashes: rendererGoneTimes.length,
  });
  if (decision.action === "ignore") {
    return;
  }
  const canReload = decision.action === "offer-reload";
  const { response } = await showMessage({
    type: "error",
    title: "PMO Desk window stopped",
    message: decision.message,
    buttons: canReload ? ["Reload", "Quit PMO Desk"] : ["Quit PMO Desk"],
    defaultId: 0,
    cancelId: canReload ? 1 : 0,
    noLink: true,
  });
  if (canReload && response === 0 && mainWindow) {
    void mainWindow.loadURL(appUrl);
  } else {
    app.quit();
  }
}

/** The window stopped answering: it may recover, so waiting is an option. */
async function handleWindowUnresponsive() {
  desktopLog("The PMO Desk window is not responding.", "error");
  if (isQuitting || unresponsiveDialogOpen) {
    return;
  }
  unresponsiveDialogOpen = true;
  try {
    const { response } = await showMessage({
      type: "warning",
      title: "PMO Desk is not responding",
      message: "The PMO Desk window is not responding.",
      detail: "Wait for it to recover, reload the page, or quit.",
      buttons: ["Reload", "Keep waiting", "Quit PMO Desk"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0 && mainWindow) {
      void mainWindow.loadURL(appUrl);
    } else if (response === 2) {
      app.quit();
    }
  } finally {
    unresponsiveDialogOpen = false;
  }
}

// ---------------------------------------------------------------------------
// PMO reminders: poller, notification click, badge, optional tray
// ---------------------------------------------------------------------------

function startReminders() {
  reminderPoller = pmoNotifier.createReminderPoller({
    getBaseUrl: () => appUrl,
    isReady: () => Boolean(appUrl) && ui.ready && !uiRestarting && !isQuitting,
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
      tray.setToolTip(label ? `PMO Desk - ${label}` : "PMO Desk");
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
    // icon.ico holds 16-256 px drawings (16 px is the simplified mark), so the tray gets a
    // crisp one at any display scale.
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.ico")));
    tray.setToolTip("PMO Desk");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open PMO Desk", click: showMainWindow },
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
    // rather than leave PMO Desk running invisibly.
    desktopLog(`Could not create the tray icon: ${error && error.message}`, "error");
    tray = undefined;
    if (mainWindow) mainWindow.show();
  }
}

/** Only our own window, showing our own origin, may talk to these handlers. */
function isFromMainWindow(event) {
  return Boolean(
    mainWindow &&
    event.sender === mainWindow.webContents &&
    urlGuard.isAppUrl(event.sender.getURL(), appUrl) &&
    (!event.senderFrame || urlGuard.isAppUrl(event.senderFrame.url, appUrl)),
  );
}

/** The page may use notifications (PMO reminders) and copy to the clipboard;
 *  every other permission request is refused. */
function installPermissionHandlers() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = urlGuard.isPermissionAllowed(
      permission,
      (details && details.requestingUrl) || webContents.getURL(),
      appUrl,
    );
    if (!allowed) {
      desktopLog(`Denied permission request: ${permission}`);
    }
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    urlGuard.isPermissionAllowed(permission, requestingOrigin, appUrl),
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
      ? displaySettings.fxModeFor(
          displaySettings.readDisplaySettings(displayFile),
          currentGpu(),
        )
      : "lean";
});

function currentGpu() {
  return displaySettings.describeGpu({
    featureStatus: app.getGPUFeatureStatus(),
    launchedWithGpu: !displaySettings.shouldDisableHardwareAcceleration(launchedDisplay),
  });
}

function displayState() {
  return {
    saved: displaySettings.readDisplaySettings(displayFile).hardwareAcceleration,
    ...currentGpu(),
  };
}

ipcMain.handle("display:get-state", (event) =>
  isFromMainWindow(event) ? displayState() : null,
);

/** The setup screen's "Browse": a folder picker over the main window. */
ipcMain.handle("setup:choose-folder", async (event) => {
  if (!isFromMainWindow(event) || !mainWindow) {
    return null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the PMO inbox folder",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/** Where the last uploaded export came from, so the next file dialog opens there. */
const lastUploadDirFile = () =>
  path.join(app.getPath("userData"), "last-upload-dir.json");

function readLastUploadDir() {
  try {
    const dir = JSON.parse(fs.readFileSync(lastUploadDirFile(), "utf8")).dir;
    return typeof dir === "string" && fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

function readExportFile(dir, name) {
  const full = path.join(dir, name);
  const stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > exportPicker.MAX_BYTES) return null;
  return { name, data: fs.readFileSync(full) };
}

/** The Run form's "newest export in Downloads": the page names only an extension and a name prefix,
 *  never a path, and only the Downloads folder is read. */
ipcMain.handle("files:newest-download", (event, want) => {
  if (!isFromMainWindow(event) || !want || typeof want !== "object") return null;
  try {
    const dir = app.getPath("downloads");
    const entries = fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      try {
        const stat = fs.statSync(path.join(dir, d.name));
        return [
          { name: d.name, mtimeMs: stat.mtimeMs, size: stat.size, isFile: stat.isFile() },
        ];
      } catch {
        return [];
      }
    });
    return exportPicker.newestMatching(entries, want);
  } catch {
    return null;
  }
});

ipcMain.handle("files:read-download", (event, name, extensions) => {
  if (!isFromMainWindow(event) || !exportPicker.isSafeName(name, extensions)) return null;
  try {
    return readExportFile(app.getPath("downloads"), name);
  } catch {
    return null;
  }
});

/** Where the Dashboard export lands first: the page captures its own screen in slices and asks to save the result. */
const MAX_CAPTURE = 6000;
const MAX_PNG_BYTES = 80 * 1024 * 1024;

ipcMain.handle("view:capture", async (event, rect) => {
  if (!isFromMainWindow(event) || !mainWindow || !rect || typeof rect !== "object")
    return null;
  const { x, y, width, height } = rect;
  const ok = [x, y, width, height].every((n) => Number.isFinite(n));
  if (!ok || width <= 0 || height <= 0 || width > MAX_CAPTURE || height > MAX_CAPTURE)
    return null;
  try {
    const image = await mainWindow.webContents.capturePage({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
    return image.toPNG();
  } catch {
    return null;
  }
});

/** Saves a picture the page made from its captures, as a PNG or a one-page PDF, wherever the person
 *  chooses in the save dialog. The page supplies image bytes and a short name, never a path. */
ipcMain.handle("view:save", async (event, format, baseName, png) => {
  if (!isFromMainWindow(event) || !mainWindow) return null;
  if (format !== "png" && format !== "pdf") return null;
  const bytes = Buffer.isBuffer(png)
    ? png
    : png instanceof Uint8Array
      ? Buffer.from(png)
      : null;
  if (!bytes || bytes.length === 0 || bytes.length > MAX_PNG_BYTES) return null;
  const name =
    typeof baseName === "string" && /^[A-Za-z0-9._ -]{1,60}$/.test(baseName)
      ? baseName
      : "export";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: format === "pdf" ? "Save as PDF" : "Save as picture",
    defaultPath: path.join(app.getPath("downloads"), `${name}.${format}`),
    filters: [
      format === "pdf"
        ? { name: "PDF", extensions: ["pdf"] }
        : { name: "PNG", extensions: ["png"] },
    ],
  });
  if (result.canceled || !result.filePath) return null;
  try {
    if (format === "png") {
      fs.writeFileSync(result.filePath, bytes);
      return result.filePath;
    }
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      const html = `<!doctype html><meta charset="utf-8"><style>@page{margin:8mm}body{margin:0}img{width:100%;display:block}</style><img src="data:image/png;base64,${bytes.toString("base64")}">`;
      await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printer.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
      });
      fs.writeFileSync(result.filePath, pdf);
    } finally {
      printer.destroy();
    }
    return result.filePath;
  } catch (error) {
    desktopLog(`Could not save the export: ${error && error.message}`, "error");
    return null;
  }
});

/** A native file dialog that opens where the last export came from (else Downloads). */
ipcMain.handle("files:choose", async (event, extensions) => {
  const exts = exportPicker.cleanExtensions(extensions);
  if (!isFromMainWindow(event) || !mainWindow || exts.length === 0) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the file",
    defaultPath: readLastUploadDir() ?? app.getPath("downloads"),
    properties: ["openFile"],
    filters: [{ name: "Files", extensions: exts.map((e) => e.slice(1)) }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const chosen = result.filePaths[0];
  try {
    fs.writeFileSync(lastUploadDirFile(), JSON.stringify({ dir: path.dirname(chosen) }));
  } catch {
    // Remembering the folder is a convenience only.
  }
  try {
    return readExportFile(path.dirname(chosen), path.basename(chosen));
  } catch {
    return null;
  }
});

/** Settings > Data: "Open folder" shows the data folder in Explorer. The page names no path. */
ipcMain.handle("platform:open-data-folder", async (event) => {
  if (!isFromMainWindow(event)) return false;
  const dir = path.join(app.getPath("userData"), "pmo");
  try {
    fs.mkdirSync(dir, { recursive: true });
    return (await shell.openPath(dir)) === "";
  } catch {
    return false;
  }
});

/** Settings > About: start the installer that the update download saved in Downloads. The page names
 *  only the file name, which must look like one the download makes. */
ipcMain.handle("platform:open-installer", async (event, name) => {
  if (!isFromMainWindow(event)) return false;
  const file = platformShell.installerPath(app.getPath("downloads"), name);
  if (!file || !fs.existsSync(file)) return false;
  desktopLog(`Starting the downloaded installer ${name}.`);
  return (await shell.openPath(file)) === "";
});

ipcMain.handle("display:set-hardware-acceleration", (event, enabled) => {
  if (!isFromMainWindow(event) || typeof enabled !== "boolean") {
    return null;
  }
  if (currentGpu().noHardwareAcceleration) {
    return displayState();
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
      title: "Restart PMO Desk",
      message: "Restart PMO Desk to apply the display setting?",
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
  desktopLog("Relaunching PMO Desk to apply the display setting.");
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

/** A tiny "starting" window: a cold start can take a while on a slow machine. */
function showSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 130,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, "icon.ico"),
    title: "PMO Desk",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const modeLine = launchConfig
    .describeMode(launch)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  const html =
    '<body style="margin:0;display:flex;flex-direction:column;justify-content:center;align-items:center;' +
    'height:100vh;font-family:Segoe UI,sans-serif;background:#1c1c1e;color:#f2f2f7">' +
    '<div style="font-size:18px">Starting PMO Desk...</div>' +
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
      submenu: [{ label: "About PMO Desk", click: showAbout }],
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
    title: "About PMO Desk",
    message: "PMO Desk",
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
  void stopServices().finally(() => {
    logWriter()?.flush();
    app.exit(0);
  });
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
  dialog.showErrorBox("PMO Desk could not start", message);
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

let desktopLogWriter;

function logWriter() {
  if (!desktopLogWriter) {
    try {
      desktopLogWriter = createLogWriter({
        file: path.join(app.getPath("userData"), "desktop.log"),
        fs,
      });
    } catch {
      // Logging must never take the app down.
    }
  }
  return desktopLogWriter;
}

function desktopLog(message, level = "log") {
  console[level](`[${new Date().toISOString()}] ${message}`);
  logWriter()?.write(message);
}
