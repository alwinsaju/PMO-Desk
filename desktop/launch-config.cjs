// Pure launch-configuration helpers for the Electron shell (desktop/main.cjs).
// Nothing here imports Electron or touches global state: the filesystem and
// environment are passed in, so `node --test desktop/launch-config.test.cjs`
// can cover it without launching the app.
//
// Modes:
//   live-dev    run `next dev` from the project directory (UI edits hot-reload)
//   live-build  run `next start` from the project directory's own `.next`
//               (run `pnpm build` yourself, then reload)
//   bundled     run `next start` from the copy installed with the app
//
// Resolution order, for both the mode and the project directory:
//   environment (AI_OS_MODE / AI_OS_PROJECT_DIR)
//   > live-config.json ({ "projectDir": "...", "mode": "..." })
//   > default
//
// The default depends on `packaged` (main.cjs passes app.isPackaged):
//   - installed/packaged build: `bundled` (production). Running a dev server
//     from an installed app is slow, so a live mode is strictly opt-in.
//   - unpackaged run (`pnpm desktop` = `electron .` from source): `live-dev`
//     from DEFAULT_PROJECT_DIR when it is usable, else bundled.
//
// Opting a packaged build into a live mode: the NSIS installer removes
// live-config.json on every reinstall, so a file next to the exe does not
// last. AI_OS_MODE (e.g. as a persistent user environment variable) is the
// durable way; live-config.json works until the next reinstall.

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const MODES = ["live-dev", "live-build", "bundled"];
const DEFAULT_PROJECT_DIR = "C:\\Projects\\AI OS";
const CONFIG_FILE_NAME = "live-config.json";
const DEFAULT_DEV_ARGS = ["--turbopack"];

/** How long a live server may take to answer before falling back to bundled. */
const LIVE_START_TIMEOUT_MS = 90_000;
const BUNDLED_START_TIMEOUT_MS = 90_000;

function isMode(value) {
  return typeof value === "string" && MODES.includes(value);
}

function isLiveMode(mode) {
  return mode === "live-dev" || mode === "live-build";
}

/**
 * Candidate config file locations, most specific first: next to the
 * executable (survives a reinstall of the app's own files), then inside the
 * app's `desktop/` folder.
 */
function configFileCandidates({ exeDir, desktopDir, path = nodePath }) {
  const candidates = [];
  if (exeDir) candidates.push(path.join(exeDir, CONFIG_FILE_NAME));
  if (desktopDir) candidates.push(path.join(desktopDir, CONFIG_FILE_NAME));
  return candidates;
}

/** Reads the first config file that exists and parses; never throws. */
function readLiveConfig(candidates, fs = nodeFs) {
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { file, config: parsed, error: null };
      }
      return { file, config: {}, error: `${file} is not a JSON object.` };
    } catch (error) {
      return {
        file,
        config: {},
        error: `${file} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { file: null, config: {}, error: null };
}

/**
 * Can a live server be run from `projectDir`? `live-build` additionally needs
 * a finished build there.
 */
function checkProjectDir(projectDir, mode, { fs = nodeFs, path = nodePath } = {}) {
  if (!projectDir) return { ok: false, reason: "no project directory is set" };
  if (!fs.existsSync(projectDir)) {
    return { ok: false, reason: `project directory ${projectDir} does not exist` };
  }
  if (!fs.existsSync(path.join(projectDir, "package.json"))) {
    return { ok: false, reason: `no package.json in ${projectDir}` };
  }
  if (!fs.existsSync(path.join(projectDir, "node_modules", "next"))) {
    return {
      ok: false,
      reason: `no node_modules/next in ${projectDir} (run pnpm install)`,
    };
  }
  if (
    mode === "live-build" &&
    !fs.existsSync(path.join(projectDir, ".next", "BUILD_ID"))
  ) {
    return {
      ok: false,
      reason: `no production build in ${projectDir}\\.next (run pnpm build)`,
    };
  }
  return { ok: true, reason: "" };
}

/**
 * Decide how to launch the UI server.
 *
 * Returns { mode, requestedMode, projectDir, notes[], fallbackReason }:
 *   - `requestedMode` is what the user/config/default asked for (the default is
 *     bundled when `packaged`, else live-dev),
 *   - `mode` is what can actually run (bundled when the request is unusable),
 *   - `fallbackReason` is set when mode differs from requestedMode,
 *   - `notes` are human-readable log lines about how it was resolved.
 */
function resolveLaunchConfig({
  env = process.env,
  fs = nodeFs,
  path = nodePath,
  exeDir,
  desktopDir,
  defaultProjectDir = DEFAULT_PROJECT_DIR,
  packaged = false,
} = {}) {
  const notes = [];
  const file = readLiveConfig(configFileCandidates({ exeDir, desktopDir, path }), fs);
  if (file.file && !file.error) notes.push(`Read launch config from ${file.file}.`);
  if (file.error) notes.push(`Ignoring launch config: ${file.error}`);

  const envDir =
    typeof env.AI_OS_PROJECT_DIR === "string" ? env.AI_OS_PROJECT_DIR.trim() : "";
  const fileDir =
    typeof file.config.projectDir === "string" ? file.config.projectDir.trim() : "";
  const projectDir = envDir || fileDir || defaultProjectDir;

  let requestedMode;
  const envMode = typeof env.AI_OS_MODE === "string" ? env.AI_OS_MODE.trim() : "";
  if (envMode && !isMode(envMode)) {
    notes.push(`Ignoring AI_OS_MODE="${envMode}" (expected ${MODES.join(", ")}).`);
  }
  if (isMode(envMode)) {
    requestedMode = envMode;
  } else {
    if (file.config.mode !== undefined && !isMode(file.config.mode)) {
      notes.push(`Ignoring launch config mode ${JSON.stringify(file.config.mode)}.`);
    }
    requestedMode = isMode(file.config.mode) ? file.config.mode : undefined;
  }

  const explicit = requestedMode !== undefined;
  if (!requestedMode) {
    if (packaged) {
      requestedMode = "bundled";
      notes.push(
        "Packaged build: defaulting to bundled (set AI_OS_MODE or live-config.json to opt into a live mode).",
      );
    } else {
      requestedMode = "live-dev";
    }
  }

  if (requestedMode === "bundled") {
    return { mode: "bundled", requestedMode, projectDir, notes, fallbackReason: null };
  }

  const check = checkProjectDir(projectDir, requestedMode, { fs, path });
  if (check.ok) {
    return {
      mode: requestedMode,
      requestedMode,
      projectDir,
      notes,
      fallbackReason: null,
    };
  }
  // An unusable default is expected on a machine without the project; only an
  // explicit request deserves a loud reason, but it is logged either way.
  const fallbackReason = `${explicit ? "Requested" : "Default"} ${requestedMode} unavailable: ${check.reason}.`;
  return { mode: "bundled", requestedMode, projectDir, notes, fallbackReason };
}

/**
 * Arguments for `next dev`, taken from the project's own `dev` script so the
 * desktop app runs it exactly as `pnpm dev` does (e.g. `next dev --turbopack`).
 * Any --port/--hostname in the script is dropped (the shell chooses those).
 */
function devServerArgs(scripts) {
  const script = scripts && typeof scripts.dev === "string" ? scripts.dev : "";
  const match = /(?:^|[\s&;])next\s+dev(?:\s+([^&;|]*))?/.exec(script);
  if (!match) return [...DEFAULT_DEV_ARGS];

  const tokens = (match[1] || "").split(/\s+/).filter(Boolean);
  const args = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (
      token === "-p" ||
      token === "--port" ||
      token === "-H" ||
      token === "--hostname"
    ) {
      i += 1; // skip the value too
      continue;
    }
    if (/^(--port|--hostname)=/.test(token) || /^-p\d+$/.test(token)) continue;
    args.push(token);
  }
  return args;
}

/** Full argv for the Next CLI (after the node executable). */
function nextServerArgs({ mode, nextCli, host, port, scripts }) {
  const bind = ["--hostname", host, "--port", `${port}`];
  if (mode === "live-dev") return [nextCli, "dev", ...devServerArgs(scripts), ...bind];
  return [nextCli, "start", ...bind];
}

/** Reads `scripts` from <projectDir>/package.json; {} on any problem. */
function readProjectScripts(projectDir, { fs = nodeFs, path = nodePath } = {}) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
    );
    return pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

/**
 * First free port at or after `start` (at most `span` candidates).
 * `isFree(port)` resolves true/false; main.cjs supplies a net-based probe.
 */
async function pickPort(isFree, start = 3100, span = 100) {
  for (let port = start; port < start + span; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port between ${start} and ${start + span - 1}.`);
}

/**
 * Names of tasks that are not "resting" in a GET /tasks payload (running,
 * waiting for review/send, finishing, or errored). Tolerates junk input.
 */
function busyTaskNames(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(
      (task) =>
        task && typeof task === "object" && task.state && task.state !== "resting",
    )
    .map((task) => `${task.displayName || task.name || task.id} (${task.state})`);
}

function startTimeoutMs(mode) {
  return isLiveMode(mode) ? LIVE_START_TIMEOUT_MS : BUNDLED_START_TIMEOUT_MS;
}

/** Window title / About text for the active mode. */
function describeMode({ mode, projectDir }) {
  return isLiveMode(mode) ? `${mode}: ${projectDir}` : "bundled";
}

function windowTitle(launch) {
  return isLiveMode(launch.mode) ? `AI OS (${describeMode(launch)})` : "AI OS";
}

module.exports = {
  BUNDLED_START_TIMEOUT_MS,
  CONFIG_FILE_NAME,
  DEFAULT_PROJECT_DIR,
  LIVE_START_TIMEOUT_MS,
  MODES,
  busyTaskNames,
  checkProjectDir,
  configFileCandidates,
  describeMode,
  devServerArgs,
  isLiveMode,
  nextServerArgs,
  pickPort,
  readLiveConfig,
  readProjectScripts,
  resolveLaunchConfig,
  startTimeoutMs,
  windowTitle,
};
