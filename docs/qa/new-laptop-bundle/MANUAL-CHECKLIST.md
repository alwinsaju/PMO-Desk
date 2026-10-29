# AI OS 2.0.0 - manual checklist for the new laptop (do in this order)

The script `Run-InstallerCheck.ps1` proves the machine-checkable parts. This sheet is what only a person can do.
Tick each box; write the number of seconds or the message wherever a line says "note". Stop at the first FAIL.
Use a NORMAL (not administrator) window. `%APPDATA%\ai-os` is the profile folder (not "AI OS").

| # | Do this | Expected | Done |
|---|---------|----------|------|
| 0 | Copy this folder, `AI OS Setup 2.0.0.exe` (and `AI OS Setup 1.0.0.exe` if you want the upgrade test) to the laptop. Run `Get-FileHash "AI OS Setup 2.0.0.exe"`. | SHA-256 `aad41131...ff6b3` (the script checks it too; if you rebuilt, compare with the source machine instead). | [ ] |
| 1 | Quit AI OS on the OLD laptop (two copies must never read the same OneDrive PMO-Inbox). On the new laptop: `.\Run-InstallerCheck.cmd -Installer "D:\AI OS Setup 2.0.0.exe" -PreviousInstaller "D:\AI OS Setup 1.0.0.exe"` (25-40 min, it installs/uninstalls several times; do not touch the machine meanwhile). | `VERDICT: PASS` in `results\<time>\results.md`. Read every WARN (first-launch seconds against 30 s / 20 s budgets, Smart App Control, PYTHON* variables). Machine is left clean. | [ ] |
| 2 | Double-click the installer yourself (the GUI path the script cannot drive). note: SmartScreen screen? Y/N | If SmartScreen shows "Windows protected your PC": More info > Run anyway (the installer is unsigned; expected once). Choose "Only for me" (no UAC prompt may appear). Keep the suggested folder or pick one with spaces. Finish page: untick "Run AI OS". | [ ] |
| 3 | Desktop and Start menu show "AI OS". Settings > Apps > Installed apps lists "AI OS 2.0.0". | Both icons start the app; one uninstall entry. | [ ] |
| 4 | Start the app with `.\Start-AiOs-Manual.ps1 -Tail` (empty PMO inbox). note: seconds from start to window: ___ | Window within 60 s (script budgets are 30 s UI + 20 s engine; the log line "Tasks engine is ready." must appear). The **Set up AI OS** screen opens by itself. If "AI OS could not start" appears: keep `%APPDATA%\ai-os\desktop.log` and `%TEMP%\ai-os-tasks-engine.log`. | [ ] |
| 5 | Set up screen, **Tasks engine** card: press Run self-test / Check again. | Ready: "passed its self-test on sample data. No email was touched." | [ ] |
| 6 | **Ollama** card: Install Ollama (needs internet, about 1.6 GB). | Progress, then Ready. No UAC prompt. With ollama.com blocked: proxy message and the "by hand" steps; nothing installed. | [ ] |
| 7 | **Model** card: Download model (about 12 GB, needs 20 GB free). Cancel once, start again; unplug the network for a minute. | Shows speed and time left; resumes where it stopped; under 16 GB RAM the smaller model is offered. | [ ] |
| 8 | **Outlook** card (read only). | Classic Outlook: Ready. Only new Outlook: explains the mail tasks need classic. Nothing opens in Outlook. | [ ] |
| 9 | Quit AI OS (File > Quit). Task Manager > Details. | No `AI OS.exe`, `python.exe`, `pythonw.exe`, `ollama.exe` left (Ollama you installed in step 6 stays if it was already running before: the app only stops one it started). | [ ] |
| 10 | **Move your data** (AI OS closed). Copy from the old machine (the repo's `agent-apps\...`, or the old install's `%APPDATA%\ai-os\tasks-engine\tasks\...`) into `%APPDATA%\ai-os\tasks-engine\tasks\`: `shift-roster\config\rotation-config.json`; `december-disconnect\config\winter-config.json` and `analytics-config.json`; `shared\roster\Names.xlsx`; `shared\roster-reference\Holiday Roster 2026.xlsx` (xlsx/xls/csv/json only: other file types there are deleted at the next start); `monthly-report-deck\reference\*.xlsx` (history months). Do not copy input/output. | Folders exist after the first run; if not, start the app once and quit, then copy. | [ ] |
| 11 | Start AI OS (`Start-AiOs-Manual.ps1`). Tasks app > **Shift Roster** > Run: upload a COPY of the roster > Check inputs. Go as far as the first review gate only. | Cycles are listed (no "rotation config is missing"). Files appear under `%APPDATA%\ai-os\tasks-engine\tasks\shift-roster\`; nothing new under the install folder. **Never press Run, Approve or Send on the four mail tasks.** | [ ] |
| 12 | Same for **December Disconnect** to its first review gate. | No "winter config is missing". | [ ] |
| 13 | **PMO inbox** card: only now, with the old laptop's AI OS quit, start with `.\Start-AiOs-Manual.ps1 -RealInbox` (or use Use this folder). | Shows the OneDrive folder and "OneDrive is signed in". Two AI OS copies must never read the same inbox at once: the first one takes the messages. | [ ] |
| 14 | While AI OS is running, run the installer again over the top by double-click. | It closes AI OS without a "cannot be closed" dialog; data from steps 10-12 is still there afterwards; app starts. | [ ] |
| 15 | Gear > **Setup and health check**. | Screen reopens. | [ ] |
| 16 | Uninstall from Settings > Apps. | Folder, shortcuts and entry gone; `%APPDATA%\ai-os` stays (your data). Delete that folder by hand for a full wipe. | [ ] |
| 17 | Reinstall, **restart Windows**, start AI OS from the Start menu. note: seconds ___ | First launch after a reboot is the slowest case (cold antivirus scan): must still open. If it ever shows "did not start within 30 seconds", the start budget is too small for this laptop. | [ ] |

Not covered by anything here: the four mail tasks (they send real e-mail), Excel COM steps, and behaviour behind a corporate proxy other than step 6.
