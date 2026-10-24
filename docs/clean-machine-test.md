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

Needs the Windows Sandbox feature (Windows 10/11 Pro, Enterprise or Education; Settings >
Optional features > More Windows features > Windows Sandbox, then restart; it needs
administrator rights once).

```powershell
.\scripts\clean-machine\run-sandbox-test.ps1 -InstallerDir $env:TEMP\aios-installer -LaunchApp
```

It writes a `.wsb` file that maps the installer folder read-only and a results folder
read-write, starts the sandbox, and waits for `results.json`. Inside, `sandbox-check.ps1`:

1. installs silently (`AI OS Setup x.y.z.exe /S`, per user, no administrator rights);
2. checks the files the app needs (app, `resources\python`, engine, tasks, shared libraries);
3. runs the engine self-test with the **bundled** Python;
4. starts the engine from the install folder with a separate data folder, checks `/health` and
   `/tasks`, and proves the install folder was not written to;
5. reports (read only) whether Ollama, classic Outlook (COM) and OneDrive are present;
6. with `-LaunchApp`, starts the real app and waits for its log to say the Tasks engine is
   ready, then checks that task data went under the app-data folder.

Exit code 0 means every required check passed. Ollama, Outlook and OneDrive are expected to
be absent in a sandbox; they are reported, not required.

`-KeepOpen` leaves the sandbox window open. In it, do the manual part below.

## 2. A virtual machine (when Sandbox is not available)

Use a Windows 11 VM with a fresh snapshot (no Python, no Ollama, no Office, not signed in to
OneDrive). Copy the installer in, then in an elevated-or-not PowerShell inside the VM:

```powershell
.\sandbox-check.ps1 -Installer "C:\path\AI OS Setup 2.0.0.exe" -ResultsDir C:\aios-check -LaunchApp
```

Revert the snapshot between runs. To test a corporate-proxy machine, put the VM behind the
same proxy settings (step 3 below).

## 3. Manual part (needs a person, a real network)

On the clean machine, after the automatic checks:

1. Start AI OS from the Start menu. The **Set up AI OS** screen opens by itself, because
   Ollama and the model are missing.
2. **Ollama**: press *Install Ollama*. Expect the progress bar (about 1.6 GB), then
   "Installing Ollama...", then the card turns Ready. Check there was no administrator
   (UAC) prompt.
   - Proxy / blocked network: with ollama.com blocked the card must show the proxy message and
     the *Do it by hand* steps, and the installer must not have run.
3. **Model**: press *Download model*. Expect progress, speed and time left. Disconnect the
   network for a minute mid-way: it must say it is trying again and continue where it
   stopped. Press *Cancel* once and start again: it resumes.
   - On a machine with under 16 GB of memory the card should offer the smaller model.
4. **PMO inbox**: with OneDrive signed out the card must say so. Sign in, press *Check again*;
   if the folder is somewhere else, paste its path (or *Browse*) and press *Use this folder*.
   Do this on a mailbox you can afford to lose messages from, or with a copy of the folder.
5. **Outlook**: with only the new Outlook installed the card must explain that new Outlook has
   no COM and what to do; with classic Outlook it is Ready. Nothing in Outlook may open.
6. **Tasks engine**: Ready, "No email was touched".
7. Open **Tasks**, run **Shift Roster** with a copy of a roster workbook through to the review
   gate (do **not** run the four mail tasks here). Confirm the files appear under
   `%APPDATA%\AI OS\tasks-engine\tasks\shift-roster\` and nothing new appears under
   `%LOCALAPPDATA%\Programs\AI OS\`.
8. Reinstall the same installer over the top and confirm the shift-roster `input`, `output`
   and `config` folders (and the run history) are still there.
9. Quit AI OS and confirm no `python`, `pythonw` or `ollama` process owned by it is left
   (Task Manager > Details).
10. Settings (gear) > *Setup and health check* reopens the screen.

## What this plan does not prove

* A real run on the old laptop's data: the roster and December Disconnect tasks are checked on
  synthetic fixtures only.
* The four mail tasks (they need classic Outlook and send real e-mail; never run in tests).
* A truly different organisation's network: the proxy path is covered by fakes in the unit
  tests and by the manual step above, not by an automatic run.
* Windows Sandbox itself could not be run where this plan was written (the feature was not
  enabled and needs administrator rights), so `run-sandbox-test.ps1` and the generated
  `.wsb` are untested end to end. `sandbox-check.ps1` is the same script and can be run
  against an unpacked build (`-AppDir <win-unpacked>`) on any machine; that run is what was
  verified.
