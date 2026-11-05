// `pnpm build`: runs `next build --turbopack`, but keeps the previous .next folder until the
// new build has succeeded. A plain `next build` empties .next first, so a failed build left
// no runnable app at all. Also puts the folder of the running Node first on PATH, because
// Turbopack starts a `node` process and fails when there is none on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, ".next");
const previous = path.join(root, ".next.previous");

let kept = false;
if (existsSync(dist)) {
  try {
    rmSync(previous, { recursive: true, force: true });
    renameSync(dist, previous);
    kept = true;
  } catch (error) {
    // Locked by a running dev server or an antivirus scan: build as before, without the safety net.
    console.warn(
      `Could not set the previous build aside (${error.message}); continuing.`,
    );
  }
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const result = spawnSync(
  process.execPath,
  [next, "build", "--turbopack", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  },
);

const ok = result.status === 0;
if (kept) {
  if (ok) {
    rmSync(previous, { recursive: true, force: true });
  } else {
    rmSync(dist, { recursive: true, force: true });
    renameSync(previous, dist);
    console.error("The build failed; the previous build in .next was put back.");
  }
}
process.exit(result.status ?? 1);
