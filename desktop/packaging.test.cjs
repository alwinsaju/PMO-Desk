// Run with `pnpm test`. Guards the packaging facts the reminder feature relies
// on: the preload and notifier ship in the installer, the Windows toast id
// matches the installer's appId, and the window keeps its security settings.
// It also guards what the Tasks engine needs from the installer: the task and
// engine folders (without anyone's data), the bundled Python and its pins, and
// the settings main.cjs hands the UI server so tasks never write into the
// install folder.
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const main = readFileSync(path.join(__dirname, "main.cjs"), "utf8");

describe("desktop packaging", () => {
  it("ships preload.cjs and pmo-notifier.cjs (desktop/** minus only the tests)", () => {
    const files = pkg.build.files;
    assert.ok(files.includes("desktop/**/*"));
    const excluded = files.filter((f) => f.startsWith("!desktop/"));
    // Nothing else under desktop/ is excluded, so the two new files go in.
    assert.deepEqual(excluded, ["!desktop/*.test.cjs", "!desktop/live-config.json"]);
  });

  it("sets the AppUserModelID to the installer's appId", () => {
    const match = /const APP_USER_MODEL_ID = "([^"]+)";/.exec(main);
    assert.ok(match, "main.cjs declares APP_USER_MODEL_ID");
    assert.equal(match[1], pkg.build.appId);
    assert.match(main, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  });

  it("tells the launch resolver whether this is a packaged build", () => {
    assert.match(main, /packaged: app\.isPackaged/);
  });

  it("loads the preload while keeping the sandbox and context isolation on", () => {
    assert.match(main, /preload: path\.join\(__dirname, "preload\.cjs"\)/);
    assert.match(main, /contextIsolation: true/);
    assert.match(main, /sandbox: true/);
    assert.match(main, /nodeIntegration: false/);
  });

  it("keeps closing the window quitting the app unless the tray setting is on", () => {
    assert.match(main, /app\.on\("window-all-closed", \(\) => app\.quit\(\)\)/);
    assert.match(main, /readDesktopPrefs\(desktopPrefsFile\(\)\)\.keepRunningInTray/);
  });

  it("the preload exposes only the documented members", () => {
    const preload = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
    assert.match(preload, /exposeInMainWorld\("aiOsDesktop"/);
    assert.match(preload, /isDesktop: true/);
    assert.match(preload, /onOpenTodo\(callback\)/);
    assert.match(preload, /setBadge\(count\)/);
    assert.match(preload, /displayMode/);
    assert.match(preload, /display: \{/);
    assert.doesNotMatch(preload, /require\((?!"electron")/);
  });

  it("reads the hardware-acceleration setting before ready and disables the GPU when OFF", () => {
    const disable = main.indexOf("app.disableHardwareAcceleration()");
    const ready = main.indexOf("app.whenReady()");
    assert.ok(
      disable > 0 && ready > 0 && disable < ready,
      "disabled before the app is ready",
    );
    assert.match(main, /shouldDisableHardwareAcceleration\(launchedDisplay\)/);
    assert.match(main, /app\.relaunch\(\)/);
    assert.match(main, /app\.releaseSingleInstanceLock\(\)/);
  });

  describe("Tasks engine contents", () => {
    const files = pkg.build.files;

    it("ships the task and engine folders", () => {
      assert.ok(files.includes("tasks/**/*"));
      assert.ok(files.includes("tasks-engine/**/*"));
    });

    it("never ships tests, caches, venvs, run history or anyone's inputs and outputs", () => {
      for (const pattern of [
        "!tasks-engine/.venv/**",
        "!tasks-engine/.data/**",
        "!tasks-engine/tests/**",
        "!tasks/.venv/**",
        "!tasks/**/tests/**",
        "!tasks/**/input/**",
        "!tasks/**/output/**",
        "!tasks/*/reference/**",
        "!tasks/**/config/backups/**",
        "!**/__pycache__/**",
      ]) {
        assert.ok(files.includes(pattern), `${pattern} is excluded`);
      }
      // exclusions come after the globs they trim
      assert.ok(files.indexOf("tasks/**/*") < files.indexOf("!tasks/**/input/**"));
    });

    it("copies the bundled Python runtime to resources/python", () => {
      assert.deepEqual(pkg.build.extraResources, [
        { from: "build/python-runtime/python", to: "python" },
      ]);
    });

    it("builds the runtime before packaging", () => {
      assert.equal(pkg.scripts["runtime:python"], "python scripts/build-python-runtime.py build");
      assert.match(pkg.scripts["desktop:package"], /^pnpm runtime:python && pnpm build && electron-builder/);
    });

    it("keeps the asar off so Python can read the task folders", () => {
      assert.equal(pkg.build.asar, false);
    });

    it("points the UI server at the bundled Python and a userData data folder, packaged builds only", () => {
      assert.match(main, /function tasksEngineEnv\(\)/);
      assert.match(main, /if \(!app\.isPackaged\) \{\s*return \{\};/);
      assert.match(main, /path\.join\(process\.resourcesPath, "python", "pythonw\.exe"\)/);
      assert.match(main, /path\.join\(app\.getPath\("userData"\), "tasks-engine"\)/);
      assert.match(main, /\.\.\.tasksEngineEnv\(\),/);
    });

    describe("python runtime pins", () => {
      const pinDir = path.join(root, "scripts", "python-runtime");
      const pin = JSON.parse(readFileSync(path.join(pinDir, "runtime.json"), "utf8"));
      const lock = readFileSync(path.join(pinDir, "requirements.lock.txt"), "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"));
      const locked = new Map(
        lock.map((line) => {
          const [spec] = line.split(" ");
          const [name, version] = spec.split("==");
          return [name, { version, line }];
        }),
      );

      it("pins the embeddable interpreter by version, URL and SHA-256", () => {
        assert.match(pin.python, /^3\.\d+\.\d+$/);
        assert.equal(pin.url, `https://www.python.org/ftp/python/${pin.python}/python-${pin.python}-embed-amd64.zip`);
        assert.equal(pin.file, `python-${pin.python}-embed-amd64.zip`);
        assert.match(pin.sha256, /^[0-9a-f]{64}$/);
      });

      it("pins every package with a version and a hash", () => {
        assert.ok(lock.length > 10);
        for (const [name, { line }] of locked) {
          assert.match(line, /^[a-z0-9-]+==[\w.]+ --hash=sha256:[0-9a-f]{64}$/, name);
        }
      });

      it("covers the engine and task requirements and ships no test tools", () => {
        const direct = ["tasks-engine/requirements.txt", "tasks/requirements.txt"].flatMap((file) =>
          readFileSync(path.join(root, file), "utf8")
            .split(/\r?\n/)
            .map((line) => /^([A-Za-z0-9_.-]+)==([\w.]+)$/.exec(line.trim()))
            .filter(Boolean),
        );
        assert.ok(direct.length >= 9);
        for (const [, rawName, version] of direct) {
          const name = rawName.toLowerCase().replace(/_/g, "-");
          if (["pytest", "pytest-cov", "coverage", "httpx"].includes(name)) {
            assert.ok(!locked.has(name), `${name} is a test tool and is not shipped`);
          } else {
            assert.equal(locked.get(name)?.version, version, `${name} is locked at ${version}`);
          }
        }
        for (const name of ["pytest", "pytest-cov", "httpx", "coverage"]) {
          assert.ok(!locked.has(name), name);
        }
      });

      it("has the build script next to the pins", () => {
        assert.ok(existsSync(path.join(root, "scripts", "build-python-runtime.py")));
      });
    });
  });
});
