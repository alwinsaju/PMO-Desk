// Which Python runs the Tasks engine (and, through it, every task step). Not a
// route - a plain module the start route imports. Nothing here comes from a
// request: the answer depends on the environment and the repo layout only.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * In order:
 *   1. AI_OS_TASKS_PYTHON - the documented setting (the desktop app points it
 *      at the Python it bundles; a developer can point it at any interpreter
 *      that has tasks-engine/requirements.txt and tasks/requirements.txt).
 *   2. tasks-engine/.venv (the venv the engine README sets up).
 *   3. pythonw / python on PATH.
 * Windowless `pythonw.exe` is preferred over `python.exe` in each case; see the
 * note in start/route.ts for why.
 */
export function resolvePython(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.AI_OS_TASKS_PYTHON?.trim();
  if (configured) return existsSync(configured) ? configured : null;

  const venvScripts = path.join(process.cwd(), "tasks-engine", ".venv", "Scripts");
  for (const name of ["pythonw.exe", "python.exe"]) {
    const candidate = path.join(venvScripts, name);
    if (existsSync(candidate)) return candidate;
  }
  return findOnPath("pythonw") ?? findOnPath("python");
}

function findOnPath(name: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [name], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim());
  return first ? first.trim() : null;
}
