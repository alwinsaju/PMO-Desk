# New-laptop bundle for the AI OS installer

Copy this whole folder to the new laptop together with `AI OS Setup 2.0.0.exe` (and, for the upgrade test,
`AI OS Setup 1.0.0.exe`). Nothing here is app source; it is test tooling.

```
.\Run-InstallerCheck.cmd -Installer "D:\AI OS Setup 2.0.0.exe" -PreviousInstaller "D:\AI OS Setup 1.0.0.exe"
```

(or `powershell -ExecutionPolicy Bypass -File .\Run-InstallerCheck.ps1 -Installer ...`). Windows PowerShell 5.1 is enough;
run it from a normal window, not "as administrator". Result: `results\<time>\results.md` (read this), `results.json`,
`logs\` (desktop.log copies, engine logs, self-test output) and `run.log`. Exit code 0 = no FAIL, 1 = a FAIL, 3 = refused.
Then do `MANUAL-CHECKLIST.md`. The written audit behind all of it is `AUDIT-NOTES.md`.

| File | Purpose |
|------|---------|
| `Run-InstallerCheck.ps1` / `.cmd` | the one-command check (replaces `scripts\clean-machine\*.ps1`, which stay untouched in the repo) |
| `Start-AiOs-Manual.ps1` | starts the installed app for the manual steps with the PMO inbox redirected to an empty folder (`-RealInbox` for the one step that needs the real one) |
| `MANUAL-CHECKLIST.md` | the human part, in order, with expected results |
| `AUDIT-NOTES.md` | payload proof, per-task behaviour on a fresh install, ranked risks, what cannot be proven here |
| `data\expected-payload-2.0.0.csv` | path + size of all 19,319 files of the audited installer (installed copy is compared against it) |
| `data\expected-keyfiles-2.0.0.json` | SHA-256 of 22 key files (app exe, Python, engine, desktop shell, task manifests) |
| `data\expected-installers.json` | SHA-256 of the audited 2.0.0 and 1.0.0 installers (detects a corrupt copy) |

## What the script does

| Phase | Needs | Checks |
|-------|-------|--------|
| 0 Preflight | any | OS/arch/RAM/disk, not elevated, Defender, Smart App Control, WDAC/AppLocker, `PYTHONHOME`/`PYTHONPATH`/`AI_OS_*` variables, default PMO inbox exists, no earlier AI OS (refuses otherwise), no other Tasks engine on 8000-8019 |
| 1 Installer | `-Installer` | SHA-256 against the audited build, manifest `asInvoker` (no UAC), signature, Mark-of-the-Web |
| 2 Install | `-Installer` | silent per-user install, time, HKCU uninstall entry (no HKLM), Desktop + Start menu shortcuts point at the exe, uninstaller present, installed files equal the payload manifest (count, size, key hashes) |
| 3 Engine | both | bundled-Python self-test and Tasks engine started like the app does (`pythonw.exe`, files for output), with an **empty PATH**; first-start time against the app's 20 s budget; `/health`, `/tasks` = the 6 tasks, all `resting`, `GET /inputs` for each; working copy tree; restart over user data (simulated reinstall): input/output/config/`shared\roster\Names.xlsx`/`history.jsonl` survive, strays pruned; install folder not written to (baseline taken before anything runs) |
| 4 First launch | both | real app with empty PMO inbox, `AI_OS_AI_AUTOSTART=0`: "Tasks engine is ready" in the NEW part of `desktop.log` (offsets, no stale log), bundled mode, UI-server and engine times against 30 s / 20 s budgets, window shown, UI and engine answer, engine is the bundled `pythonw.exe`, task data in the profile, the app's own Setup report, and Setup's own self-test through the API |
| 5 Second launch | both | single instance: the second `AI OS.exe` exits, the first stays responsive |
| 6 Quit | both | window close (graceful path) leaves no `AI OS`, `python`, `pythonw` or new `ollama` process and closes the UI and engine ports |
| 7 Relaunch | both | data of the first run is still there, second start time |
| 8 / 8b Reinstall | `-Installer` | installer over the top (app closed) keeps user data and `desktop.log`, one uninstall entry, shortcuts, payload; then **installer while the app is running** (it must finish without hanging, leave no orphaned `pythonw.exe`, and the app must start again) |
| 9 Uninstall | `-Installer` | install folder, shortcuts and registry entry gone; user data kept (by design) |
| 10 Custom path | `-Installer`, not `-Quick` | install under `%USERPROFILE%\AI OS <u-umlaut>ber test dir\AI OS` (spaces + non-ASCII), payload, engine, launch, quit, uninstall |
| 11 Upgrade | `-PreviousInstaller`, not `-Quick` | 1.0.0 installs and runs (with its own `AI_OS_SKIP_AGENT_OFFICE=1`), writes a marker, 2.0.0 installs over it: one entry, new version, files replaced, marker survives, 2.0.0 starts |

Dry run (no installer is executed, nothing is installed or uninstalled, the real profile is untouched):
`.\Run-InstallerCheck.ps1 -AppDir "C:\scratch\copy-of-win-unpacked"` runs phases 0, 2 (payload), 3, 4-7 with `--user-data-dir` inside the
results folder. If another engine already answers on 8000-8019 (the app would adopt it) the launch phases use a
script-started engine and say so.

Switches: `-Quick` (skip 8b, 10, 11), `-SkipLaunch` (no Electron), `-LeaveInstalled` (end with a pristine installed app),
`-KeepTestData`, `-AllowExistingInstall` (replaces an existing copy: do not use on a machine whose data you care about),
`-AllowOllamaStart`, `-ExpectedSha256 <hash>`, `-ResultsDir`, `-LaunchTimeoutSeconds`, `-InstallTimeoutMinutes`.

## Safety

* The PMO inbox is `AI_OS_PMO_INBOX_DIR` = an empty folder for every launch the script makes.
* The four mail tasks are only listed with GET. The script never POSTs to an engine (start/approve/send/reject/reset).
  Its only POST is the Setup screen's own `run-selftest`. It never presses install-Ollama, download-model or choose-inbox.
* It refuses to run an installer when AI OS is already installed, a profile folder exists, AI OS is running, or another
  Tasks engine answers (so it cannot damage a working copy). On a clean laptop it removes only what it created.

## What changed against `scripts\clean-machine`

| Old defect | In `Run-InstallerCheck.ps1` |
|------------|-----------------------------|
| `run-sandbox-test.ps1:35` deletes `results.json`, `:42/:62` read `out\results.json` | one `results\<time>` folder per run, nothing stale to read |
| `-KeepOpen` appended `; Read-Host` to the `-File` arguments (`:43`) | no sandbox wrapper; no argument injection |
| no shutdown at the end | the script always ends with everything stopped and (default) the machine restored |
| native stderr + `$ErrorActionPreference = "Stop"` + `2>&1` fails under 5.1 (`sandbox-check.ps1:31,77-82`) | every native call goes through `Invoke-Native` (.NET `Process`, stdout/stderr captured separately) |
| `-LaunchApp` read a stale `desktop.log` and used the real `%APPDATA%` (`:121-142`) | log is read from the byte offset recorded before launch; profile is `%APPDATA%\ai-os` (the real folder name; the old docs said `AI OS`); dry run uses `--user-data-dir`; clean-machine guard |
| "install folder not written to" baseline taken after the self-test | baseline first |
| engine started with `python.exe` | `pythonw.exe` with output redirected to files, exactly like `start/route.ts` |
| missing: uninstall, reinstall, upgrade, second launch, quit cleanliness, spaces path, no-admin proof, shortcuts, first-launch time | phases 2, 5-11 |
