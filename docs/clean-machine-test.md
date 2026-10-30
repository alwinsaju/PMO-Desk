# Clean-machine test plan

Goal: prove that **one installer plus the first-run setup** is enough on a computer that has
never seen this project: no repo, no Agents-workspace, no Python, no Ollama, no signed-in
OneDrive. Run it before handing the installer to anyone, and after changing the installer
contents, the bundled Python or the setup screen.

Never run it against the real PMO inbox: a fresh profile starts the PMO poller, which moves
messages out of the inbox folder it finds. The scripts below point the app at an empty temp
folder (`AI_OS_PMO_INBOX_DIR`). If you test by hand, do the same or test on a machine whose
OneDrive is not signed in.

## 0. Build the installer somewhere safe

```powershell
pnpm runtime:python                      # the pinned private Python (cached after the first run)
pnpm build
pnpm exec electron-builder --win nsis --config.directories.output=$env:TEMP\aios-installer
```

Passing `--config.directories.output` keeps the test build out of `release/`. Expect an
installer of roughly 260 MB (about 70 MB of that is the Python and its packages).

## 1. Windows Sandbox (preferred: disposable, no VM to maintain)

> **Managed or company PCs: check first.** Windows Sandbox is usually switched off on a
> managed PC (Intune/MDM or Group Policy), and Hyper-V is often refused too. On such a PC
> the policy keys `AllowMappedFolders`, `AllowWriteToMappedFolders` and `AllowNetworking`
> under `HKLM\SOFTWARE\Microsoft\PolicyManager\current\device\WindowsSandbox` are `0`, and
> enabling the optional feature does not help. `run-sandbox-test.ps1` reads these keys and
> stops at once with the reason; do not wait for it. Use section 2 (a VM, or a spare
> unmanaged laptop) instead, and never ask IT to relax the policy on a production machine
> just for this test.

Needs the Windows Sandbox feature (Windows 10/11 Pro, Enterprise or Education; Settings >
Optional features > More Windows features > Windows Sandbox, then restart; it needs
administrator rights once).

```powershell
.\scripts\clean-machine\run-sandbox-test.ps1 -InstallerDir $env:TEMP\aios-installer -LaunchApp -Lifecycle
```

It writes a `.wsb` file that maps the installer folder read-only and a results folder
read-write, starts the sandbox, and waits for `<results folder>\out\results.json` (a result
left by an earlier run is removed first, so it can never be mistaken for this one). Without
`-KeepOpen` the sandbox shuts itself down when the results are written. Inside,
`sandbox-check.ps1`:

1. installs silently (`AI OS Setup x.y.z.exe /S`, per user, no administrator rights) and
   checks there was no elevation, both shortcuts and exactly one uninstall entry;
2. checks the files the app needs (app, `resources\python` with `python.exe` and
   `pythonw.exe`, engine, tasks, shared libraries);
3. runs the engine self-test with the **bundled** Python (stderr output is not a failure);
4. starts the engine from the install folder with `pythonw.exe` (as the app does) and a
   separate data folder, checks `/health` and `/tasks`, and proves the install folder was not
   written to (the file count is taken before the self-test);
5. reports (read only) whether Ollama, classic Outlook (COM) and OneDrive are present;
6. with `-LaunchApp`, starts the real app with a **fresh profile** (`--user-data-dir` under the
   results folder, so a stale `desktop.log` or the real `%APPDATA%\ai-os` can never be read)
   and waits for the new log to say the Tasks engine is ready, then checks: start time,
   window shown, task data in the profile, a second launch is refused (single instance), a
   graceful quit leaves no `AI OS`, `python` or `pythonw` process, and a relaunch comes up
   again with the first run's data intact;
7. with `-Lifecycle`, installs over the top (user data in `%APPDATA%\ai-os` kept), then
   uninstalls (files, shortcuts and uninstall entry gone, user data kept by design). It ends
   with AI OS removed and refuses to run when AI OS or `%APPDATA%\ai-os` already exist.

Exit code 0 means every required check passed. Ollama, Outlook and OneDrive are expected to
be absent in a sandbox; they are reported, not required.

`-KeepOpen` leaves the sandbox open (not combinable with `-Lifecycle`, which uninstalls). In
it, do the manual part below.

## 2. A virtual machine (when Sandbox is not available, e.g. a managed PC)

Use a Windows 11 VM with a fresh snapshot (no Python, no Ollama, no Office, not signed in to
OneDrive). Copy the installer in, then in a normal (not elevated) PowerShell inside the VM:

```powershell
.\sandbox-check.ps1 -Installer "C:\path\AI OS Setup 5.0.0.exe" -ResultsDir C:\aios-check -LaunchApp -Lifecycle
```

Do not run this on your everyday PC: it installs, reinstalls and uninstalls AI OS. To check
an unpacked build instead, without installing anything, use `-AppDir <win-unpacked>` (no
`-Lifecycle`); `-LaunchApp` still uses a fresh profile and an empty PMO inbox.

Revert the snapshot between runs. To test a corporate-proxy machine, put the VM behind the
same proxy settings (step 3 below).

## 3. Manual part (needs a person, a real network)

On the clean machine, after the automatic checks:

0. **Unsigned installer.** `AI OS Setup x.y.z.exe` and `AI OS.exe` are not code-signed, so
   Windows SmartScreen shows "Windows protected your PC" on the first run of each. Choose
   _More info_ > _Run anyway_. On a managed machine that blocks it outright (Smart App Control,
   AppLocker, Windows Defender Application Control, an endpoint-security allow-list), ask IT to
   allow the installer or the install folder (`%LOCALAPPDATA%\Programs\AI OS`) by path or file
   hash; a code-signing certificate would remove the need. The same applies to the bundled
   `python.exe` / `pythonw.exe` under `resources\python`, which the Tasks engine launches.

1. Start AI OS from the Start menu. The **Set up AI OS** screen opens by itself, because
   Ollama and the model are missing.
2. **Ollama**: press _Install Ollama_. Expect the progress bar (about 1.6 GB), then
   "Installing Ollama...", then the card turns Ready. Check there was no administrator
   (UAC) prompt.
   - Proxy / blocked network: with ollama.com blocked the card must show the proxy message and
     the _Do it by hand_ steps, and the installer must not have run.
3. **Model**: press _Download model_. Expect progress, speed and time left. Disconnect the
   network for a minute mid-way: it must say it is trying again and continue where it
   stopped. Press _Cancel_ once and start again: it resumes.
   - On a machine with under 16 GB of memory the card should offer the smaller model.
4. **PMO inbox**: with OneDrive signed out the card must say so. Sign in, press _Check again_;
   if the folder is somewhere else, paste its path (or _Browse_) and press _Use this folder_.
   Do this on a mailbox you can afford to lose messages from, or with a copy of the folder.
5. **Outlook**: with only the new Outlook installed the card must explain that new Outlook has
   no COM and what to do; with classic Outlook it is Ready. Nothing in Outlook may open.
6. **Tasks engine**: Ready, "No email was touched".
7. Open **Tasks**, run **Shift Roster** with a copy of a roster workbook through to the review
   gate (do **not** run the four mail tasks here). Confirm the files appear under
   `%APPDATA%\ai-os\tasks-engine\tasks\shift-roster\` and nothing new appears under
   `%LOCALAPPDATA%\Programs\AI OS\`.
8. Reinstall the same installer over the top and confirm the shift-roster `input`, `output`
   and `config` folders (and the run history) are still there.
9. Quit AI OS and confirm no `python`, `pythonw` or `ollama` process owned by it is left
   (Task Manager > Details).
10. Settings (gear) > _Setup and health check_ reopens the screen.

## What this plan does not prove

- A real run on the old laptop's data: the roster and December Disconnect tasks are checked on
  synthetic fixtures only.
- The four mail tasks (they need classic Outlook and send real e-mail; never run in tests).
- A truly different organisation's network: the proxy path is covered by fakes in the unit
  tests and by the manual step above, not by an automatic run.
- Windows Sandbox itself could not be run where this plan was written (it is disabled by
  device policy there), so the `.wsb` generation, the guest `-Command` line and the
  shutdown-at-the-end are untested end to end. `sandbox-check.ps1` is the same script the
  guest runs; its `-AppDir ... -LaunchApp` path (fresh profile, single instance, graceful
  quit, relaunch) was run against an unpacked build and passes. The installer-only parts
  (`-Installer`, `-Lifecycle`: silent install, shortcuts, uninstall entry, reinstall,
  uninstall) have not been run yet.
- Not covered by `sandbox-check.ps1`: an upgrade over 1.0.0, a path with spaces or non-ASCII
  letters, installing while the app runs, SmartScreen, and a comparison of the installed
  files with an audited build. `docs/qa/new-laptop-bundle/Run-InstallerCheck.ps1` covers
  those on a real laptop.
