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
    assert.match(
      preload,
      /chooseFolder: \(\) => ipcRenderer\.invoke\("setup:choose-folder"\)/,
    );
    assert.match(preload, /displayMode/);
    assert.match(preload, /display: \{/);
    assert.doesNotMatch(preload, /require\((?!"electron")/);
  });

  it("answers the setup screen's folder picker only for the main window", () => {
    const handler =
      /ipcMain\.handle\("setup:choose-folder", async \(event\) => \{([\s\S]*?)\n\}\);/.exec(
        main,
      );
    assert.ok(handler, "main.cjs handles setup:choose-folder");
    assert.match(handler[1], /!isFromMainWindow\(event\)/);
    assert.match(handler[1], /properties: \["openDirectory"\]/);
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

    it("never ships a task's real data folders or files, wherever they sit under tasks/", () => {
      for (const pattern of [
        "!tasks/**/config/**",
        "!tasks/**/templates/**",
        "!tasks/**/reference/**",
        "!tasks/**/backups/**",
        "!tasks/shared/roster-reference/**/*.xls*",
        "!tasks/shared/roster/Names.xlsx",
        "!tasks/**/*.snapshot.json",
        "!tasks/**/*.plan.json",
        "!tasks/**/.venv/**",
        "!tasks/**/~$*",
      ]) {
        assert.ok(files.includes(pattern), `${pattern} is excluded`);
        assert.ok(
          files.indexOf("tasks/**/*") < files.indexOf(pattern),
          `${pattern} trims tasks/**/*`,
        );
      }
    });

    it("ships the Outlook export scripts (resources/app/pmo-intake/scripts) without their tests", () => {
      assert.ok(files.includes("pmo-intake/scripts/*.ps1"));
      assert.ok(files.includes("!pmo-intake/scripts/tests/**"));
      assert.ok(
        files.indexOf("pmo-intake/scripts/*.ps1") <
          files.indexOf("!pmo-intake/scripts/tests/**"),
      );
      for (const name of ["Export-OutlookToInbox.ps1", "OutlookMapping.ps1"]) {
        assert.ok(existsSync(path.join(root, "pmo-intake", "scripts", name)), name);
      }
    });

    it("copies the bundled Python runtime to resources/python", () => {
      assert.deepEqual(pkg.build.extraResources, [
        { from: "build/python-runtime/python", to: "python" },
      ]);
    });

    it("leaves build-only weight out of the installer, including pnpm's real package folders", () => {
      for (const pattern of [
        "!node_modules/@next/swc-win32-x64-msvc/**",
        "!node_modules/.pnpm/@next+swc-*/**",
        "!node_modules/sharp/**",
        "!node_modules/.pnpm/sharp@*/**",
        "!node_modules/.pnpm/@img+*/**",
        "!.next/**/*.map",
      ]) {
        assert.ok(files.includes(pattern), `${pattern} is excluded`);
        assert.ok(
          files.indexOf("node_modules/**/*") < files.indexOf(pattern),
          `${pattern} trims node_modules`,
        );
      }
      assert.deepEqual(pkg.build.electronLanguages, ["en-US"]);
    });

    it("stops an orphaned engine before an install, upgrade or uninstall", () => {
      assert.equal(pkg.build.nsis.include, "build/installer.nsh");
      const nsh = readFileSync(path.join(root, "build", "installer.nsh"), "utf8");
      assert.match(nsh, /pythonw\.exe/);
      assert.match(nsh, /!macro customInit/);
      assert.match(nsh, /!macro customUnInit/);
    });

    it("creates the AI-OS OneDrive folders on a first install only, and asks for no e-mail address", () => {
      const nsh = readFileSync(path.join(root, "build", "installer.nsh"), "utf8");
      assert.match(nsh, /!macro customInstall/);
      // Works out whether AI OS was already installed before copying anything.
      assert.match(
        nsh,
        /ReadRegStr \$0 HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/,
      );
      assert.match(nsh, /\$\{If\} \$aiOsExisting == "0"/);
      // The OneDrive folder comes from OneDrive's own account list, not from a typed address.
      assert.match(
        nsh,
        /Software\\Microsoft\\OneDrive\\Accounts\\Business\$1" "UserFolder"/,
      );
      // No page that asks for input (a color hook on the stock welcome/finish pages is fine).
      assert.doesNotMatch(nsh, /nsDialogs|InputBox|MUI_PAGE_CUSTOM(?!FUNCTION_SHOW)/i);
      for (const folder of [
        "AI-OS\\PMO-Inbox",
        "AI-OS\\Staff-Exchange\\requests",
        "AI-OS\\Staff-Exchange\\profiles",
        "AI-OS\\Staff-Exchange\\rejected",
        "AI-OS\\PTO-Inbox",
      ]) {
        assert.ok(nsh.includes(`CreateDirectory "$aiOsOneDrive\\${folder}"`), folder);
      }
      // The marker that makes the app open the first-time setup page, never overwritten.
      assert.match(nsh, /\$APPDATA\\ai-os\\pmo\\first-time-setup\.json/);
      assert.match(
        nsh,
        /\$\{IfNot\} \$\{FileExists\} "\$APPDATA\\ai-os\\pmo\\first-time-setup\.json"/,
      );
    });

    it("builds the runtime before packaging", () => {
      assert.equal(
        pkg.scripts["runtime:python"],
        "python scripts/build-python-runtime.py build",
      );
      assert.match(
        pkg.scripts["desktop:package"],
        /^pnpm runtime:python && pnpm build && electron-builder/,
      );
    });

    it("keeps the asar off so Python can read the task folders", () => {
      assert.equal(pkg.build.asar, false);
    });

    it("points the UI server at the bundled Python and a userData data folder, packaged builds only", () => {
      assert.match(main, /function tasksEngineEnv\(\)/);
      assert.match(main, /if \(!app\.isPackaged\) \{\s*return \{\};/);
      assert.match(
        main,
        /path\.join\(process\.resourcesPath, "python", "pythonw\.exe"\)/,
      );
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
        assert.equal(
          pin.url,
          `https://www.python.org/ftp/python/${pin.python}/python-${pin.python}-embed-amd64.zip`,
        );
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
        const direct = [
          "tasks-engine/requirements.txt",
          "tasks/requirements.txt",
        ].flatMap((file) =>
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
            assert.equal(
              locked.get(name)?.version,
              version,
              `${name} is locked at ${version}`,
            );
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
