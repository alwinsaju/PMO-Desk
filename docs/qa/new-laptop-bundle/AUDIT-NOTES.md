# AI OS 2.0.0 installer - new-laptop audit

Date 2026-10-25. Repo HEAD `6dba299`. Installer under audit: `release\AI OS Setup 2.0.0.exe`
(257,279,627 bytes, SHA-256 `aad41131746684895eac567ddbd195f86933f804a8ca146798124985870ff6b3`, built 07:49 from `9f6bbf2`).
Host: Windows 11 Enterprise 26100, MDM-locked (no Sandbox/Hyper-V), Ryzen 7 PRO 8840U, 31 GB, Defender real-time on.
Every claim is tagged **[V]** verified (how), **[R]** read-only inference from code/templates, **[U]** unverified.
Nothing under `release\`, `.next\`, the installed copy, `%APPDATA%\ai-os`, OneDrive, Outlook or the user's Ollama was touched.
All experiments ran on copies in the session scratchpad (installer extracted with 7-Zip, never executed).

## 1. Ranked risks

Installer-blocking or first-launch-blocking (fix or consciously accept before the new laptop):

1. **Start budgets are tight and a miss is fatal.** `desktop/launch-config.cjs` gives the bundled UI server 30 s
   (`BUNDLED_START_TIMEOUT_MS`), `src/app/api/tasks-engine/start/route.ts` gives the engine 20 s (`START_TIMEOUT_MS`).
   If either runs out, `desktop/main.cjs` `startDesktopApp` throws into `showStartupFailure`: "AI OS could not start" and the app exits
   (an engine failure also stops the whole app, not just Tasks). Bundled mode shows no splash during the wait. **[R]** for the logic.
   **[V]** measured on this fast host: UI server 23.9 s, 26.6 s, 24.1 s and 26.1 s in cold-ish runs (4 separate runs, the last from a copy under a path with spaces and non-ASCII letters; "Ready in 12-14 s" plus about 7 s for the first page render),
   but 1.7 s and 3.1 s warm; engine first start 12.4-13.1 s cold, 2.3 s warm; Setup self-test 35-54 s cold. The same machine swings 10x with cache/antivirus state, so a slower laptop
   after a reboot or a Defender update can exceed 30 s / 20 s. **[U]** what the new laptop does. Fix (not done, source is read-only here): raise to 90 s / 60 s, add a splash, and let Tasks degrade instead of exiting.
2. **Shift Roster and December Disconnect cannot run on a fresh install.** `config\`, `templates\`, `reference\`, `input\`, `output\` and the user data under `shared\` are not shipped
   (package.json `files`; the repo's own copies are gitignored and empty). Both tasks need `config\rotation-config.json` (and `winter-config.json`, `analytics-config.json`), created only by the `seed_config`
   command-line tool from a gitignored `seed-names.json`; its README points at a dev venv (`tasks-engine\.venv`) that the install does not have. **[V]** `Paths/load_config_file` of the shipped task, run with the bundled Python on a fresh working copy:
   "the rotation config is missing (config/rotation-config.json); it is created once from the roster with the seed_config tool"; December Disconnect's loader has the same message for its configs. The four mail tasks all read
   `shared\roster\Names.xlsx` (**[R]**, `build_report.py`/`build_email_data.py`), and Monthly Report Deck needs history workbooks in `reference\` (`prepare_data.py`). The owner must copy these from the old machine
   (list in `MANUAL-CHECKLIST.md` step 10; they exist today in `agent-apps\...`). Nothing in the app imports them.
3. **PYTHONHOME / PYTHONPATH inherited by the engine break it, and then the app will not open.** `start/route.ts` passes `process.env` plus `PYTHONNOUSERSITE=1` only. **[V]** engine start with `PYTHONHOME=C:\Python_does_not_exist`:
   `ModuleNotFoundError: No module named 'fastapi'`, no `/health` in 25 s; with `PYTHONPATH` holding a fake `fastapi`: the fake is imported. An empty `PATH` is fine **[V]**. Unlikely on a new laptop; the script's preflight warns when set.
4. **The installer ends `AI OS.exe` by name, not the engine.** NSIS template `_CHECK_APP_RUNNING` -> `KILL_PROCESS "AI OS.exe"` (**[V]** in `app-builder-lib@26.15.3` templates, which `builder-debug.yml` shows were used). The engine is `resources\python\pythonw.exe`, a child of the Next server (`AI OS.exe`
   in node mode) with no job object; killing the parent leaves it alive (**[R]**, ordinary Windows behaviour; I did not run the installer to see the lock). A reinstall/upgrade while AI OS runs can then hit locked `python313.dll`/`.pyd` files; a silent install has no `/SD` for a
   file-write error and would wait on a hidden dialog. Script phase 8b exercises exactly this on the laptop. Quitting AI OS first avoids it.
5. **Unsigned everything.** **[V]** installer: Authenticode certificate table size 0, `Get-AuthenticodeSignature` NotSigned; `AI OS.exe`, `elevate.exe` NotSigned; `python.exe`, `pythonw.exe`, `python313.dll` Valid (Python Software Foundation). Installer manifest is `asInvoker` **[V]** (no UAC).
   Expect SmartScreen "unknown publisher" once. On a laptop with Smart App Control enforced, WDAC or AppLocker, unsigned exes in `%LOCALAPPDATA%` can be blocked outright with no "run anyway" **[U]**. This host: Smart App Control off (state 0), no AppLocker policy, WDAC user mode 0, and unsigned copies run here **[V]**. The script reports all three on the new laptop.
6. **PMO defaults are the developer's.** `DEFAULT_INBOX_DIR = C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox`, `me` = Alwin Saju / alsaju@deloitte.com, blocked domain takeda.com (`src/lib/pmo/types.ts`) **[V]** found in four server chunks, the PMO app's SSR chunk and one client chunk of the payload.
   Same Windows user name + OneDrive on the new laptop = the new AI OS starts consuming the same OneDrive PMO-Inbox at first launch (project memory: a fresh profile still ingests and deletes real inbox items). With another user name the Setup card says the folder is missing. Quit the old laptop's AI OS first; use `Start-AiOs-Manual.ps1` (empty inbox) until the cut-over.
7. **The installer is two commits behind HEAD.** `a7af903` (Force reset stops the run in flight; `tasks-engine/main.py` differs from the payload) and `6dba299` (PMO structuring v4; `src/` only) are not in `AI OS Setup 2.0.0.exe` **[V]** (byte comparison of the repo against the extracted payload: only `main.py` differs among `desktop/`, `tasks-engine/`, `tasks/`). Rebuild before shipping, or accept. The script's payload comparison turns into warnings for a rebuilt installer.

Lower: model download is about 12 GB (needs about 20 GB free; Setup warns); Ollama install and model pull need the network and may meet a proxy **[U]**; Excel/Outlook COM for the mail tasks **[U]**; ARM64 laptop would run the x64 build under emulation **[U]**.

## 2. Payload proof

Extraction: `7za x` (electron-builder's own 7-Zip from `%LOCALAPPDATA%\electron-builder\Cache`) of the installer into a scratch folder, no execution. **[V]**

* 19,319 files, 997,499,477 bytes (951 MB), 1,700 folders. The installer's payload is **byte-identical** to `release\win-unpacked` (19,319 files, 0 differences by SHA-1; the 07:49 vs 07:39 timestamps are the NSIS wrap of the same build) **[V]**.
* Present **[V]**: `AI OS.exe` (Electron 44.9.3; `asar:false`, so `resources\app` is a plain folder, not `app.asar`); `resources\app\.next` (BUILD_ID `Ett8J2gsUmwIThjSjpFYM`, server + static chunks, 46 MB); `resources\app\node_modules` (366 MB: next 15.5.24, react, zod, zustand, sharp and swc win32-x64 binaries; no `.bin`,
  no dev tools); `desktop\` (main, launch-config, preload, display-settings, pmo-notifier, icon.ico/png; tests and live-config.json excluded); `public\sw.js`; `tasks-engine\` (main.py, workcopy.py, selftest.py, README, pyproject, requirements; tests excluded; a stray `.coverage` file is included);
  `tasks\` (106 files: 6 tasks with task.json, TASK.md, scripts, and the 4 `.ps1` mail steps; `shared\roster_lib`, `shared\winter_lib` with their `examples\`, `shared\assets` logos, `shared\roster\name_matching.py`); `resources\python\` (210 MB): `python.exe`, `pythonw.exe`, `python313.dll`, `python313.zip`, 20 `.pyd`, `libcrypto/libssl/libffi/sqlite3`,
  `vcruntime140(_1).dll`, `Lib\site-packages` with all 9 pinned packages plus fastapi/uvicorn dependencies (1,473 `.py` and 1,473 `.pyc`, so no compile at first start), no `python313._pth`. `resources\elevate.exe` (electron-builder leftover; no updater in the app, nothing references it **[V]** grep).
* **Not shipped**: `pmo-intake\` including `Export-OutlookToInbox.ps1` / `OutlookMapping.ps1` (nothing in the app references them **[V]** grep; they are a producer you run where Outlook is; copy by hand if wanted), `agent-apps\`, `docs\`, `scripts\`, tests, `.venv`.
* Python is self-contained **[V]**: PE import tables of every `.pyd`/`.dll`/`.exe` under `resources\python` (own parser, kernel32 alone is imported by 177 of them): every DLL that is not bundled is a Windows in-box DLL or an api-set (kernel32, advapi32, ws2_32, ... plus `api-ms-win-crt-*` from the in-box UCRT); **no `msvcp140.dll`/`vcomp140.dll`**, so no Visual C++ Redistributable is needed
  (numpy and scipy carry their own libs in `numpy.libs` / `scipy.libs`). Engine and self-test ran with an empty PATH **[V]**.
* Longest packaged path is 149 characters (`resources\app\node_modules\next\dist\compiled\react-server-dom-webpack-experimental\cjs\...`). The default folder `C:\Users\<name>\AppData\Local\Programs\AI OS\` is about 44 + len(name) characters, so about 195 total with a 6-letter name: safe up to a user name of roughly 60 characters **[V]**. `LongPathsEnabled=0` here and everything worked (the .NET/Node/Python stacks used avoid MAX_PATH) **[V]**.
* Dev-machine strings in the payload **[V]** (full byte scan of 19,317 files): `C:\Projects\AI OS` in `desktop\launch-config.cjs` (`DEFAULT_PROJECT_DIR`, only used by the live modes, which a packaged build does not default to: it logged "Packaged build: defaulting to bundled"), in `.next\required-server-files.json`, `tasks\FIRST-RUN-GUIDE.md`, `tasks-engine\.coverage`, and as compile paths inside the `.pyc` files;
  `alsaju` in the PMO defaults above and in the unused console-script launchers `site-packages\bin\*.exe` (shebang to a Microsoft-Store Python of the build machine). No `OneDrive - Deloitte` outside the PMO default.
  No global Python, Node or pnpm is needed at run time: the shell runs the UI with its own `AI OS.exe` as node (`ELECTRON_RUN_AS_NODE=1`) and the engine with `resources\python\pythonw.exe` **[V]** (ran both from a copy).

## 3. What the installer does (NSIS 3.04, electron-builder 26.15.3, `oneClick:false`)

* Per user, no administrator rights **[V]** manifest `requestedExecutionLevel level="asInvoker"`; default folder `%LOCALAPPDATA%\Programs\AI OS` **[R]** `multiUser.nsh` (this owner's install is `C:\Projects\Live apps\AI OS`, picked on the directory page: `allowToChangeInstallationDirectory`). The GUI offers "Anyone who uses this computer", which needs UAC **[R]**.
* Registry **[V]** (read from the owner's real install): `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\3dec7c8f-642f-5dc8-a98d-cee7af750c97`, DisplayName "AI OS 2.0.0", `QuietUninstallString ... /currentuser /S`; install folder in `HKCU\Software\3dec7c8f-...\InstallLocation`.
* Shortcuts **[V]** (owner's machine): `AI OS.lnk` on the Desktop (here OneDrive-redirected) and in the Start menu, target the install exe; `createDesktopShortcut`/`createStartMenuShortcut` true.
* Running instance **[R]**: asks (silent: assumes yes) and ends `AI OS.exe` by name, retries, then "app cannot be closed" dialog (risk 4).
* Reinstall over an existing install **[R]**: finds the old uninstaller from the registry and runs it with `/S --updated`, which deletes the install folder and keeps the app-data folder; then installs. A user file placed in the install folder would be lost; the app writes nothing there except possibly `tasks-engine\__pycache__` **[V]** (one `workcopy*.pyc` appeared in one of my copies, none in another; `.next\cache` is not created).
* Uninstall **[R]**/**[V]**: removes the install folder, shortcuts, registry keys; `deleteAppDataOnUninstall` is not set in `package.json`, so `%APPDATA%\ai-os` (PMO data, task working copy, history, `desktop.log`) is **kept**; `--delete-app-data` wipes it.
* Profile folder is **`%APPDATA%\ai-os`**, not `AI OS` (package.json `name` is `ai-os`, no `productName`; the owner's `%APPDATA%` has `ai-os`). QA-PLAN and `docs\clean-machine-test.md` say `AI OS`; the script checks both.
* Upgrade from 1.0.0 **[R]**: same appId and productName, so the same uninstall key; 1.0.0 is removed by its own uninstaller, 2.0.0 installed in the same folder, profile `ai-os` carries over (PMO data, display settings, logs). **1.0.0 kept its tasks in an external agent-office engine; nothing in 2.0.0 imports that data** (grep: no migration code), and 2.0.0 starts with an empty working copy. 1.0.0 on a clean laptop cannot start without agent-office (its `main.cjs`). Script phase 11 runs 1.0.0 with its `AI_OS_SKIP_AGENT_OFFICE=1`.

## 4. Fresh-install simulation (copy of the payload in `...\sim J<o-umlaut>s<e-acute> <N-tilde>and<u-acute> <日本>\AI OS\` - spaces and non-ASCII; engine on 8190-8192, UI on 3290; no installer run)

* Engine, `pythonw.exe`, `AI_OS_TASKS_DATA_DIR` = empty folder (same non-ASCII path) **[V]**: `/health` after 13.1 s cold, 2.3-2.5 s warm; `GET /tasks` lists the 6 tasks, all `resting`; per-task `GET /inputs` ok, no input present; no `history.jsonl` until a run.
  Working copy created: 101 files, `<task>\{task.json, scripts, input, output, config}` for all 6 (empty input/output/config), `shared\{assets,roster,roster-reference,roster_lib,winter_lib}`.
* Setup's self-test exactly as the app runs it (console python, `PYTHONNOUSERSITE=1`, cwd `tasks-engine`) **[V]**: ok, Python 3.13.14, all 9 packages import, example configs load, a task-style step runs; 35.5 s cold (53.7 s with an empty PATH under load).
* Simulated reinstall **[V]** (stop engine, change a shipped script, add a shipped file, delete a shipped file, add user files, start again): working copy updated (changed file refreshed, new file added, removed file removed); `input/`, `output/`, `config/`, per-task `reference/`, a mail task's `config/`, `shared/roster/Names.xlsx`,
  `shared/roster-reference/*.xlsx|.csv|.json` (also in a subfolder) and `history.jsonl` all survived; non-protected strays (`.txt`/`.py` under `shared\roster*`, anything in `shared\roster_lib`, a file in a task root) were pruned. Consequence: a `.docx`/`.pdf` kept in `shared\roster-reference` is deleted at every start.
* Engine with `PATH` = a missing folder **[V]**: starts in 2.5 s; hostile env: see risk 3. Stop with `taskkill /T /F` (what the app does): no `python`/`pythonw` left **[V]**.
* The shipped UI (`next start` with `AI OS.exe` as node, env as `desktop/main.cjs` sets it, PATH/LOCALAPPDATA/ProgramFiles/OneDrive* sanitised, Ollama pointed at a closed port, inbox = empty folder) **[V]**: `GET /api/setup` with Ollama absent: Ollama **missing** ("not installed"; Install button), Model **missing** (waits for Ollama), PMO inbox ok (fixed by `AI_OS_PMO_INBOX_DIR`), Engine unknown until the self-test (then **ok**), Outlook ok (read only, this host has classic Outlook); `ready=false`, so the Setup screen opens at launch.
  With the real PATH: "Ollama is installed but is not running right now" (found at `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`). Ollama is looked up in this order: `AI_OS_OLLAMA_EXE`, every `PATH` folder, `%LOCALAPPDATA%\Programs\Ollama`, `%ProgramFiles%\Ollama`; the server address is `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`), model `OLLAMA_MODEL` (default `gemma4:12b`) **[V]** `core.ts`. Cross-origin requests to the setup API get 403 **[V]**.
  (My status/config GETs also showed the route scans 8000-8019 and adopts any engine that answers `/health`: another process's engine on 8000 was reported. This is why the script refuses to run when one is present.)

## 5. First-run behaviour per task on a fresh install

| Task | Needs that is not shipped | What the app/engine does |
|------|---------------------------|--------------------------|
| shift-roster | `config\rotation-config.json`; Holiday Roster (shipped reference copy is excluded; upload one, `persist`) | Listed and runnable only after a roster upload; analyze/prepare fail with "rotation config is missing ... seed_config" **[V]** |
| december-disconnect | `config\winter-config.json`, `analytics-config.json`, shift-roster's `rotation-config.json`; uploads (roster, staff roster) | "the winter config is missing (config/winter-config.json)..." **[R]** (message in `_common.py`), same loader pattern as above |
| weekly-aging-report | `shared\roster\Names.xlsx`; classic Outlook + Excel COM for later steps | Engine refuses Run until the incident export is uploaded ("missing required input(s)") **[R]**; then `build_report.py` fails reading Names.xlsx before any Outlook step **[R]**. Never run here |
| weekly-backlog-report | same + Excel (`Recalc-Workbook.ps1`) | same |
| deployment-dep-weekend-mailer | `Names.xlsx`; the weekly workbook upload; Outlook COM | same |
| monthly-report-deck | `Names.xlsx`; `reference\` history workbooks (`Monthly Incidents Trend Analysis - *.xlsx`) | `prepare_data.py` raises "... found in reference or output" **[R]** |

Mail templates (`.msg`) listed under `templates\` are not used by any script **[V]** (grep). `config`/`reference` are "seed once" folders, but there is nothing in the install to seed from, so a user's copy is the only source.

## 6. Not provable on this host

Real NSIS execution (registry, shortcuts, per-user folder, uninstall, reinstall, upgrade, running-app handling), silent-mode dialogs, SmartScreen/Smart App Control/EDR/AppLocker on the new laptop, cold-start timing on the new laptop, Windows Defender's verdict on 19,000 new files, ARM64, OneDrive/Outlook/Excel presence,
Ollama install and the 12 GB model pull behind the corporate proxy, reboot-cold first launch. `Run-InstallerCheck.ps1` covers the machine-checkable ones on the laptop; `MANUAL-CHECKLIST.md` the rest.

## 7. Dry-run results of `Run-InstallerCheck.ps1 -AppDir` on this host

Against an unpacked copy (ASCII path, then a copy under a path with a space and non-ASCII letters), isolated profile, empty inbox, 8000 busy with someone else's engine so the script used its own engine for the launch phases: final runs: PASS, 0 FAIL (37 PASS / 3 WARN on the non-ASCII-path copy, 36 / 2 on the ASCII one); WARNs for the foreign engine and, when cold, for the 26 s UI start (the warm run took 3 s). Negative tests: a hollow folder fails
"required runtime files" and "bundled Python"; `-Installer` against this machine (installed AI OS, profile, a running process) is refused with exit code 3 before anything runs (tested with a dummy file, so no installer could have started).
Registry/shortcut helpers were run read-only against the owner's real install and parse it correctly (they needed the real DisplayName "AI OS 2.0.0" and the key GUID, which an earlier draft got wrong).
