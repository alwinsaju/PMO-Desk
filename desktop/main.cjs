const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, existsSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const launchConfig = require("./launch-config.cjs");

const HOST = "127.0.0.1";
const PREFERRED_PORT = 3100;
const PORT_SPAN = 100;
const AGENT_OFFICE_START_TIMEOUT_MS = 60_000;
const SERVER_STOP_TIMEOUT_MS = 10_000;
const PORT_FREE_TIMEOUT_MS = 10_000;
const AGENT_OFFICE_API_URL =
  process.env.NEXT_PUBLIC_AGENT_OFFICE_API_URL?.trim() || "http://localhost:8000";
const OUTPUT_TAIL_LINES = 25;

let mainWindow;
let splashWindow;
let isQuitting = false;
let port;
let appUrl;

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
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch(showStartupFailure);
}

async function startDesktopApp() {
  launch = launchConfig.resolveLaunchConfig({
    exeDir: path.dirname(process.execPath),
    desktopDir: __dirname,
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
  await startAgentOffice();
  buildMenu();
  createWindow();
  closeSplash();
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
 *  worker, and the owned backend is its child). Resolves when gone. */
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
 * backend it owns, since the backend is its child), starts it again in the
 * same mode on the same port (the web origin, and with it saved settings,
 * stays the same), re-launches the backend and reloads the window.
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
            "Restarting also restarts the backend and STOPS those runs.\n\n"
          : "") +
        "The backend (Agent Office) is restarted together with the UI server. " +
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

    await startAgentOffice();
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
    const response = await fetch(`${AGENT_OFFICE_API_URL}/tasks`, {
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
// Agent Office backend (started and stopped through the UI server's routes)
// ---------------------------------------------------------------------------

async function startAgentOffice() {
  desktopLog("Starting Agent Office.");
  const response = await fetch(`${appUrl}/api/agent-office/start`, {
    method: "POST",
    signal: AbortSignal.timeout(AGENT_OFFICE_START_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Agent Office start request failed: ${response.status}.`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.reason || "Agent Office could not start.");
  }
  desktopLog("Agent Office is ready.");
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
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  void mainWindow.loadURL(appUrl);
}

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

/** Ask the UI server to stop the backend and the local AI runtime it owns. */
async function requestServiceShutdown() {
  // A dev server may need to compile these routes on first use.
  const timeout = ui.mode === "live-dev" ? 20_000 : 5_000;
  try {
    const response = await fetch(`${appUrl}/api/agent-office/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      throw new Error(`Agent Office stop request failed: ${response.status}.`);
    }
  } catch (error) {
    desktopLog(
      `Could not request a clean Agent Office shutdown: ${
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
