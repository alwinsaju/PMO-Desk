const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PREFERRED_PORT = 3100;
const SERVER_START_TIMEOUT_MS = 30_000;
const SERVER_STOP_TIMEOUT_MS = 10_000;

let mainWindow;
let nextServer;
let isQuitting = false;
let port;
let appUrl;

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
  port = await findAvailablePort(PREFERRED_PORT);
  appUrl = `http://${HOST}:${port}`;
  desktopLog(`Starting AI OS from ${app.getAppPath()}.`);
  await startNextServer();
  await waitForServer();
  await startAgentOffice();
  createWindow();
}

async function startNextServer() {
  const appPath = app.getAppPath();
  const nextCli = path.join(appPath, "node_modules", "next", "dist", "bin", "next");

  desktopLog(`Starting Next.js with ${nextCli}.`);
  nextServer = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", HOST, "--port", `${port}`],
    {
      cwd: appPath,
      detached: false,
      env: {
        ...process.env,
        AI_OS_DESKTOP_MODE: "1",
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  nextServer.stdout.on("data", (data) => {
    desktopLog(data.toString().trim());
  });
  nextServer.stderr.on("data", (data) => {
    desktopLog(data.toString().trim(), "error");
  });
  nextServer.once("error", (error) => {
    if (!isQuitting) {
      showStartupFailure(error);
    }
  });
  nextServer.once("exit", (code) => {
    if (!isQuitting) {
      showStartupFailure(
        new Error(`The AI OS server exited unexpectedly (code ${code}).`),
      );
    }
  });
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (nextServer?.exitCode !== null && nextServer?.exitCode !== undefined) {
      throw new Error(`The AI OS server exited with code ${nextServer.exitCode}.`);
    }

    try {
      const response = await fetch(appUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The server has not finished binding its loopback port yet.
    }

    await delay(250);
  }

  throw new Error(
    `AI OS did not start within ${SERVER_START_TIMEOUT_MS / 1000} seconds.`,
  );
}

async function startAgentOffice() {
  desktopLog("Starting Agent Office.");
  const response = await fetch(`${appUrl}/api/agent-office/start`, {
    method: "POST",
    signal: AbortSignal.timeout(SERVER_START_TIMEOUT_MS),
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "AI OS",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  void stopServices().finally(() => app.exit(0));
});

async function stopServices() {
  if (!nextServer || nextServer.exitCode !== null) {
    return;
  }

  try {
    const response = await fetch(`${appUrl}/api/agent-office/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
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

  await stopProcess(nextServer);
}

function stopProcess(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, SERVER_STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

function showStartupFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error && error.stack ? error.stack : message;
  desktopLog(details, "error");
  dialog.showErrorBox("AI OS could not start", message);
  isQuitting = true;
  void stopServices().finally(() => app.exit(1));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findAvailablePort(candidatePort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE" && candidatePort < PREFERRED_PORT + 100) {
        resolve(findAvailablePort(candidatePort + 1));
        return;
      }
      reject(error);
    });
    probe.listen(candidatePort, HOST, () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function desktopLog(message, level = "log") {
  const line = `[${new Date().toISOString()}] ${message}`;
  console[level](line);
  appendFileSync(path.join(app.getPath("userData"), "desktop.log"), `${line}\n`);
}
