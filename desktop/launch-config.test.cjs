// Run with `node --test desktop/launch-config.test.cjs`. Pure logic only: a
// fake filesystem stands in for the disk and nothing launches Electron or a
// server.
const assert = require("node:assert/strict");
const path = require("node:path").win32;
const { describe, it } = require("node:test");
const cfg = require("./launch-config.cjs");

/** Fake fs over a { absolutePath: contents } map; directories are implied. */
function fakeFs(files) {
  const entries = Object.keys(files);
  const norm = (p) => p.replace(/[\\/]+$/, "");
  return {
    existsSync: (p) => entries.some((e) => e === norm(p) || e.startsWith(`${norm(p)}\\`)),
    readFileSync: (p) => {
      if (!(norm(p) in files)) throw new Error(`ENOENT ${p}`);
      return files[norm(p)];
    },
  };
}

const PROJECT = "C:\\Projects\\AI OS";
const goodProject = {
  [`${PROJECT}\\package.json`]: JSON.stringify({
    scripts: { dev: "next dev --turbopack" },
  }),
  [`${PROJECT}\\node_modules\\next\\package.json`]: "{}",
};
const withBuild = { ...goodProject, [`${PROJECT}\\.next\\BUILD_ID`]: "x" };

function resolve(files, env = {}, extra = {}) {
  return cfg.resolveLaunchConfig({
    env,
    fs: fakeFs(files),
    path,
    exeDir: "C:\\Apps\\AI OS",
    desktopDir: "C:\\Apps\\AI OS\\resources\\app\\desktop",
    ...extra,
  });
}

describe("resolveLaunchConfig", () => {
  it("defaults to live-dev on the default project dir when usable", () => {
    const r = resolve(goodProject);
    assert.equal(r.mode, "live-dev");
    assert.equal(r.projectDir, PROJECT);
    assert.equal(r.fallbackReason, null);
  });

  it("falls back to bundled when the project dir is missing", () => {
    const r = resolve({});
    assert.equal(r.mode, "bundled");
    assert.equal(r.requestedMode, "live-dev");
    assert.match(r.fallbackReason, /does not exist/);
  });

  it("falls back when node_modules/next is missing", () => {
    const r = resolve({ [`${PROJECT}\\package.json`]: "{}" });
    assert.equal(r.mode, "bundled");
    assert.match(r.fallbackReason, /node_modules\/next/);
  });

  it("AI_OS_MODE overrides the config file mode", () => {
    const files = {
      ...withBuild,
      "C:\\Apps\\AI OS\\live-config.json": JSON.stringify({ mode: "bundled" }),
    };
    assert.equal(resolve(files).mode, "bundled");
    assert.equal(resolve(files, { AI_OS_MODE: "live-build" }).mode, "live-build");
  });

  it("live-build needs a finished build, else falls back", () => {
    assert.equal(resolve(withBuild, { AI_OS_MODE: "live-build" }).mode, "live-build");
    const r = resolve(goodProject, { AI_OS_MODE: "live-build" });
    assert.equal(r.mode, "bundled");
    assert.match(r.fallbackReason, /pnpm build/);
  });

  it("bundled never inspects the project dir", () => {
    const r = resolve({}, { AI_OS_MODE: "bundled" });
    assert.equal(r.mode, "bundled");
    assert.equal(r.fallbackReason, null);
  });

  it("AI_OS_PROJECT_DIR beats the config file, which beats the default", () => {
    const other = "D:\\Work\\ai-os";
    const files = {
      ...goodProject,
      [`${other}\\package.json`]: "{}",
      [`${other}\\node_modules\\next\\package.json`]: "{}",
      "D:\\cfg\\live-config.json": JSON.stringify({ projectDir: "Z:\\nowhere" }),
    };
    assert.equal(resolve(files, { AI_OS_PROJECT_DIR: other }).projectDir, other);
    const viaFile = resolve(files, {}, { exeDir: "D:\\cfg" });
    assert.equal(viaFile.projectDir, "Z:\\nowhere");
    assert.equal(viaFile.mode, "bundled");
  });

  it("prefers the config next to the exe over the one in desktop/", () => {
    const files = {
      "C:\\Apps\\AI OS\\live-config.json": JSON.stringify({ mode: "bundled" }),
      "C:\\Apps\\AI OS\\resources\\app\\desktop\\live-config.json": JSON.stringify({
        mode: "live-build",
      }),
    };
    assert.equal(resolve(files).mode, "bundled");
  });

  it("ignores a broken config file and an invalid mode, with notes", () => {
    const broken = resolve({
      ...goodProject,
      "C:\\Apps\\AI OS\\live-config.json": "{ not json",
    });
    assert.equal(broken.mode, "live-dev");
    assert.ok(broken.notes.some((n) => /could not be read/.test(n)));

    const badMode = resolve(goodProject, { AI_OS_MODE: "turbo" });
    assert.equal(badMode.mode, "live-dev");
    assert.ok(badMode.notes.some((n) => /AI_OS_MODE/.test(n)));
  });
});

describe("resolveLaunchConfig: packaged builds", () => {
  const packaged = { packaged: true };
  const cfgFile = (obj) => ({
    "C:\\Apps\\AI OS\\live-config.json": JSON.stringify(obj),
  });

  it("defaults to bundled with a note, whether or not the project is usable", () => {
    for (const files of [{}, goodProject]) {
      const r = resolve(files, {}, packaged);
      assert.equal(r.mode, "bundled");
      assert.equal(r.requestedMode, "bundled");
      assert.equal(r.fallbackReason, null);
      assert.ok(
        r.notes.includes(
          "Packaged build: defaulting to bundled (set AI_OS_MODE or live-config.json to opt into a live mode).",
        ),
      );
    }
  });

  it("honours live-config.json mode live-dev", () => {
    const r = resolve({ ...goodProject, ...cfgFile({ mode: "live-dev" }) }, {}, packaged);
    assert.equal(r.mode, "live-dev");
    assert.equal(r.fallbackReason, null);
    assert.ok(!r.notes.some((n) => /Packaged build/.test(n)));
  });

  it("honours AI_OS_MODE=live-build", () => {
    const r = resolve(withBuild, { AI_OS_MODE: "live-build" }, packaged);
    assert.equal(r.mode, "live-build");
  });

  it("an explicit live request that cannot run still falls back to bundled", () => {
    const r = resolve({}, { AI_OS_MODE: "live-dev" }, packaged);
    assert.equal(r.mode, "bundled");
    assert.equal(r.requestedMode, "live-dev");
    assert.match(r.fallbackReason, /^Requested live-dev unavailable/);
  });

  it("an invalid mode in the file means the bundled default", () => {
    const r = resolve({ ...goodProject, ...cfgFile({ mode: "turbo" }) }, {}, packaged);
    assert.equal(r.mode, "bundled");
    assert.ok(r.notes.some((n) => /Ignoring launch config mode/.test(n)));
  });

  it("env beats the file in both directions", () => {
    const live = { ...withBuild, ...cfgFile({ mode: "live-dev" }) };
    assert.equal(resolve(live, { AI_OS_MODE: "bundled" }, packaged).mode, "bundled");
    const bundled = { ...withBuild, ...cfgFile({ mode: "bundled" }) };
    assert.equal(
      resolve(bundled, { AI_OS_MODE: "live-build" }, packaged).mode,
      "live-build",
    );
    // Same precedence when unpackaged.
    assert.equal(resolve(live, { AI_OS_MODE: "bundled" }).mode, "bundled");
    assert.equal(resolve(bundled, { AI_OS_MODE: "live-build" }).mode, "live-build");
  });

  it("unpackaged keeps the live-dev default (explicit packaged: false too)", () => {
    assert.equal(resolve(goodProject, {}, { packaged: false }).mode, "live-dev");
    const missing = resolve({}, {}, { packaged: false });
    assert.equal(missing.mode, "bundled");
    assert.equal(missing.requestedMode, "live-dev");
    assert.ok(!missing.notes.some((n) => /Packaged build/.test(n)));
  });
});

describe("devServerArgs / nextServerArgs", () => {
  it("reads the dev script's flags", () => {
    assert.deepEqual(cfg.devServerArgs({ dev: "next dev --turbopack" }), ["--turbopack"]);
  });

  it("drops port and hostname flags", () => {
    assert.deepEqual(
      cfg.devServerArgs({
        dev: "next dev --turbopack -p 4000 --hostname 0.0.0.0 --port=1",
      }),
      ["--turbopack"],
    );
  });

  it("falls back to --turbopack when the script is unusable", () => {
    assert.deepEqual(cfg.devServerArgs({}), ["--turbopack"]);
    assert.deepEqual(cfg.devServerArgs({ dev: "vite" }), ["--turbopack"]);
    assert.deepEqual(cfg.devServerArgs(undefined), ["--turbopack"]);
  });

  it("builds the argv per mode", () => {
    const base = {
      nextCli: "next.js",
      host: "127.0.0.1",
      port: 3101,
      scripts: { dev: "next dev --turbopack" },
    };
    assert.deepEqual(cfg.nextServerArgs({ ...base, mode: "live-dev" }), [
      "next.js",
      "dev",
      "--turbopack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3101",
    ]);
    assert.deepEqual(cfg.nextServerArgs({ ...base, mode: "live-build" }), [
      "next.js",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3101",
    ]);
    assert.deepEqual(cfg.nextServerArgs({ ...base, mode: "bundled" }).slice(0, 2), [
      "next.js",
      "start",
    ]);
  });
});

describe("pickPort", () => {
  it("returns the first free port from the start", async () => {
    const busy = new Set([3100, 3101]);
    assert.equal(await cfg.pickPort(async (p) => !busy.has(p), 3100), 3102);
    assert.equal(await cfg.pickPort(async () => true, 3100), 3100);
  });

  it("throws when the whole span is busy", async () => {
    await assert.rejects(
      cfg.pickPort(async () => false, 3100, 5),
      /No free port/,
    );
  });
});

describe("labels and timeouts", () => {
  it("describes live and bundled modes", () => {
    assert.equal(cfg.windowTitle({ mode: "bundled", projectDir: PROJECT }), "AI OS");
    assert.equal(
      cfg.windowTitle({ mode: "live-dev", projectDir: PROJECT }),
      `AI OS (live-dev: ${PROJECT})`,
    );
  });

  it("gives live modes the longer start timeout", () => {
    assert.equal(cfg.startTimeoutMs("live-dev"), 90_000);
    assert.equal(cfg.startTimeoutMs("bundled"), 90_000);
  });
});

describe("busyTaskNames", () => {
  it("lists only tasks that are not resting", () => {
    assert.deepEqual(
      cfg.busyTaskNames([
        { id: "a", name: "A", state: "resting" },
        { id: "b", name: "B", state: "working" },
        { id: "c", state: "awaiting_send" },
      ]),
      ["B (working)", "c (awaiting_send)"],
    );
  });

  it("tolerates junk", () => {
    assert.deepEqual(cfg.busyTaskNames(null), []);
    assert.deepEqual(cfg.busyTaskNames({ ok: false }), []);
    assert.deepEqual(cfg.busyTaskNames([null, 3, {}]), []);
  });
});
