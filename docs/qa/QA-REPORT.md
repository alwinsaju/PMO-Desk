# AI OS 2.0.0 — QA report

Date: 2026-10-25 · Build tested: `release/AI OS Setup 2.0.0.exe` (built 07:49; byte-identical to `release/win-unpacked`) · Repo HEAD: `6dba299`
Plan: [QA-PLAN.md](QA-PLAN.md) · Installer bundle for the new laptop: [new-laptop-bundle/](new-laptop-bundle/) · Evidence: `evidence/host-run-1/`, `evidence/sandbox-run-1/` · Test harness: `harness/`

Two commits are **not** in the tested installer: `a7af903` (Force reset now stops the run in flight) and `6dba299` (PMO structuring v4, several to-dos from one message). Anything touching those is tagged **[post-build]** and must be re-checked on the next package.

---

## 1. Executive summary

**Verdict: do not hand over this installer yet.** The app itself is in good shape (clean typecheck, 1,099 unit tests and ~1,500 Python tests pass, idle CPU is negligible, no memory leak found in 60 open/close cycles). But five things would hurt on a brand-new laptop, and two of them make a first launch fail or look broken:

| # | Blocker for the new laptop | Why it matters | Source IDs |
|---|---|---|---|
| 1 | **Start-up time limits are too tight, and one miss is fatal.** UI server must be up in 30 s, Tasks engine in 20 s. If either misses, the app shows "AI OS could not start" and exits. There is no splash in the installed build, so the user sees nothing for 20–40 s and double-clicks again (which does nothing). | Measured on this fast laptop: UI server 24–27 s on cold starts (cap 30 s), engine 12–13 s (cap 20 s), main→engine-ready 38 s on one cold launch. A slower laptop after a reboot or with aggressive AV can miss it. An optional subsystem (Tasks engine) takes the whole app down, including the Setup screen that exists to diagnose problems. | WF-002, WF-009, CQ-009, SBX-019 |
| 2 | **Shift Roster and December Disconnect cannot run on a fresh install.** Config, templates, reference data and `Names.xlsx` are excluded from the package; the config can only be created by a command-line tool that needs your private names file. | Both tasks show "rotation config is missing" / "winter config is missing" with no way to fix it in the UI. The four mail tasks also need `shared/roster/Names.xlsx` and (Monthly Report Deck) history workbooks. `clean-machine-test.md` step 7 cannot pass. | SBX-012, installer audit |
| 3 | **Your identity and paths are the defaults.** Default inbox is `C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox`; "me" is Alwin Saju / alsaju@deloitte.com; allowed domain only `deloitte.com`, blocked `takeda.com`. | Same Windows user + signed-in OneDrive on the new laptop = the new install starts ingesting (and deleting) the shared PMO inbox at first launch while the old laptop may still be running. A different username shows a "folder missing" Setup card, and "me" is wrong in every AI prompt. | WF-011, SBX-013 |
| 4 | **The installer is two commits behind HEAD.** | Needs a rebuild once the above are fixed. | installer audit |
| 5 | **Unsigned installer and `AI OS.exe`.** | Expect a one-time SmartScreen "unknown publisher". If the new laptop enforces Smart App Control, AppLocker or WDAC it may be blocked outright (cannot be known in advance). | installer audit |

Also high priority but not install-blocking: the **Tasks engine accepts state-changing requests from any web page** (no origin check or token; includes approve/send for mail tasks), the **PMO pipeline can silently lose data** in five specific ways (Section 4), and the **bundled Next.js has a critical advisory** (low practical exposure, but trivial to bump).

### Counts (deduplicated sources are cross-referenced, not merged away)

| Source | S1 | S2 | S3 | S4 | IMP |
|---|---|---|---|---|---|
| Workflow / logic review (WF-001…035) | 1 | 7 | 19 | 8 | 19 listed separately |
| Code quality (CQ-001…045) | 0 | 2 | 11 | 11 | 13 |
| Host GUI run + tooling (SBX-001…035) | 0 | 1 | 14 | 8 | 11 (+1 environment blocker) |

Several findings are the same issue seen from different angles (engine auth: WF-001/CQ-001/CQ-003; engine start fatal: WF-002/CQ-009/SBX-019; owner defaults: WF-011/SBX-013). Section 3 is the deduplicated working list.

---

## 2. What was tested, and how much to trust it

| Track | Method | Result |
|---|---|---|
| A. Clean install / uninstall / upgrade / first run | **Not run.** Windows Sandbox is disabled by IT policy (`AllowNetworking`, `AllowMappedFolders`, `AllowWriteToMappedFolders` all 0, MDM-enforced); Hyper-V refuses access. | Replaced by: byte-for-byte payload extraction, fresh-install simulation of the engine from a copy (path with spaces and non-ASCII), and a script bundle for the new laptop. Real NSIS install/uninstall/upgrade, SmartScreen, cold start on the new machine are **unproven**. |
| B/C/D. Features, UI, UX, performance | **Run** against a copy of `win-unpacked` on this host with a throw-away profile, empty PMO inbox/data/tasks folders, AI stub for deterministic PMO structuring, driven over the DevTools protocol with screenshots. Real Ollama, Outlook, OneDrive inbox, the old engine on :8000 and the mail tasks were never touched. | Detailed coverage in Section 8. |
| E. Code quality | Static + `pnpm typecheck/lint/test/format:check`, engine and per-task pytest, `pnpm audit`, import-graph and AST dead-code scans. | Section 6. |
| F. Logic / workflow | Code reading plus throwaway scripts against pure-logic modules (several defects reproduced). | Section 4. |

Not covered at all: real-model behaviour (Ollama inference, install, 12 GB model pull), toasts/reminders/chasers/sign-off/Outlook export, App Store uninstall, offline behaviour, off-screen windows, DPI 150 % live (emulated only), mail tasks (by rule), approval past the first review gate (by rule).

Environment note: this host sets `NODE_TLS_REJECT_UNAUTHORIZED=0` at user and machine level; the app inherits it (CQ-005). It is the host's setting, but the app should strip it from its child servers.

---

## 3. Deduplicated findings, ranked

Severity scale: S1 crash/data loss/unsafe action · S2 feature broken, no workaround · S3 impaired, workaround exists · S4 cosmetic · IMP improvement. Confidence: **Run** = reproduced, **Read** = confirmed by reading code, **Susp** = suspected.

### 3.1 Installer / first-run (release blockers)

| ID | Sev | Finding | Fix | Refs |
|---|---|---|---|---|
| R-1 | S2 | Start budgets (UI 30 s, engine 20 s) are tight; any miss exits the app; no splash in bundled mode; second double-click is ignored. Engine start also runs `workcopy.sync()` at import, before FastAPI loads. | Show window/splash immediately; start the engine in the background, non-fatally (Tasks app and Setup screen show the reason with Retry); raise budgets to ≥90 s / 60 s; never `app.exit(1)` for an optional subsystem; focus the window on second launch. | WF-002, WF-009, CQ-009, SBX-019 |
| R-2 | S2 | Shift Roster / December Disconnect (and all mail tasks) lack config/templates/reference/`Names.xlsx` on a fresh install. Run: "config/rotation-config.json is missing; created once from the roster with seed_config". | Decide the delivery model: ship an empty-but-valid config set, or add an in-app "Import my task data" step that copies from a folder; at minimum make the error say exactly what to copy and where. | SBX-012, installer audit, WF Q11 |
| R-3 | S2/S3 | Owner identity, OneDrive inbox path and domain allow/block lists are hard-coded defaults. `/api/pmo/config` returns the OneDrive path even when `AI_OS_PMO_INBOX_DIR` overrides it. | First-run "who are you" step (name variants, email, domains); derive the inbox from the OneDrive root and create `PMO-Inbox` only on confirmation; never auto-consume a folder the user has not confirmed. | WF-011, SBX-013 |
| R-4 | S3 | Installer predates `a7af903` and `6dba299`. | Rebuild after fixes; re-run the new-laptop bundle. | installer audit |
| R-5 | S3 | Installer and `AI OS.exe` unsigned (python binaries are signed). | Sign if the org has a cert; otherwise document SmartScreen "More info → Run anyway" and ask IT about Smart App Control/WDAC beforehand. | installer audit |
| R-6 | S3 | Engine inherits the full environment: a stray `PYTHONHOME`/`PYTHONPATH` breaks it (verified), and then the app will not start (R-1). | Scrub `PYTHON*` variables when spawning the bundled interpreter. | installer audit |
| R-7 | S3 | NSIS kills `AI OS.exe` by name only; an orphaned `pythonw.exe` engine can lock files during reinstall/upgrade. | Add `pythonw.exe`/engine to the installer's kill list, or stop the engine via the app before upgrade. Test with bundle phase 8b. | installer audit |
| R-8 | S3 | Data folder is `%APPDATA%\ai-os`, not `AI OS` as README, `clean-machine-test.md`, ARCHITECTURE and `sandbox-check.ps1` say. Nothing migrates 1.0.0/agent-office data. Uninstall keeps the profile (by design). | Fix the docs (or add top-level `productName` with a one-time migration); decide the 1.0.0 migration story. | CQ-040, installer audit |
| R-9 | IMP | Installer weight: ~70–80 MB can be dropped (not measured): `@next/swc-win32-x64-msvc` (145 MB uncompressed, build-time only), `sharp`/`@img` (19 MB, unused), `.next/**/*.map` (15.8 MB), Electron locales except en-US (~45 MB), shipped `pytest.ini` files and a stray `tasks-engine/.coverage`. Verify the bundled server boots without swc first. | `files` excludes + `electronLanguages: ["en-US"]`; longer term `output: "standalone"`. | CQ-031, CQ-045 |
| R-10 | IMP | `pmo-intake/Export-OutlookToInbox.ps1` is not shipped and nothing in the app runs it, yet it is the only Outlook→inbox path. | Decide: ship it with an in-app "Run Outlook export now" and Task Scheduler recipe, or document that Power Automate is the only producer. | installer audit, WF improvements |

### 3.2 Security / safety

| ID | Sev | Finding | Fix | Refs |
|---|---|---|---|---|
| SEC-1 | S2 (reviewers disagreed: S1 workflow, S2 code audit; mitigations: needs a task already at a gate, loopback only, browsers may prompt for local-network access) | The Tasks engine accepts body-less `POST /tasks/{id}/start|approve|reject|send|reset` with no auth, no Origin/Host check. Body-less POSTs are CORS "simple requests", so any web page can fire them at `127.0.0.1:8000-8019`. `approve`/`send` are the human gates for real Outlook sends. Several Next routes also lack origin checks (`/api/tasks-engine/stop|start`, `/api/ai/command`, `/api/browser/check-embeddable`). Not exploited; **Read**. | Per-launch random token generated by the shell, required in a custom header on all non-GET engine and `/api/tasks-engine/*` routes (also forces a preflight); reject non-loopback `Host`; one Next `middleware.ts` applying `checkOrigin` to `/api/*`; `frame-ancestors 'none'` and CSP headers. | WF-001, CQ-001, CQ-003, CQ-004 |
| SEC-2 | S3 | Engine found by scanning ports 8000–8019 with no instance identity; another user's/instance's engine would be adopted. A foreign engine really answers on :8000 on this machine today. | Per-launch id echoed by `/health`; adopt only a matching engine. | WF-008, CQ-002 |
| SEC-3 | S3 | `next 15.5.24` has a critical advisory (SVG image optimizer RCE) plus DoS/cache-poisoning; `zod 4.4.3` high. Exposure is low (loopback, no `next/image`) but trivial to fix. | Bump `next`/`eslint-config-next` to ≥15.5.28, `zod` ≥4.6.6, `images.unoptimized: true`. | CQ-006 |
| SEC-4 | S3 | `NODE_TLS_REJECT_UNAUTHORIZED=0` is inherited by the UI server (certificate checks off for fetches, Ollama installer download, model pulls). | Delete it from the child env, log once, offer `NODE_EXTRA_CA_CERTS`. | CQ-005 |
| SEC-5 | S3 | `check-embeddable` SSRF guard is literal-host only (IPv6-mapped, CGNAT, DNS-resolved private names, redirects); ignores HTTP status (403/405 counts as embeddable → blank iframe). | DNS check, manual redirect re-validation, status check, origin check. | CQ-007, WF-030 |
| SEC-6 | S4 | Electron hardening gaps: `startsWith(appUrl)` origin checks (`:31001` passes), no `will-navigate` guard, no permission handler, no `senderFrame` check. Good: contextIsolation, sandbox, small preload, IPC sender checks. | Compare `new URL().origin`; add guards. | CQ-008, WF-029 |
| SEC-7 | S3 | Windows can be dragged off-screen (see UI-2). Command bar `delete_note`/`update_note` act on a model tool call with no confirm/undo; update replaces the entire note body. | Confirm or 10 s undo; keep previous content. | WF-020 |
| SEC-8 | S3 | One-click **Confirm & send**, **Reject** and **Force reset** on mail tasks with no confirmation; Reject leaves the Outlook draft with no hint. Reject/Reset resets immediately. | Confirm dialog echoing recipients/subject; confirm Force reset mid-run; note about a leftover draft. | WF-018, SBX-025 |
| SEC-9 | S3 | Lock screen looks like security (password field) but accepts anything; users may type their Windows password. | Remove the field ("press Enter") or make it real. | WF-022 |

### 3.3 Data loss and logic (PMO and Tasks engine)

All **Run** unless noted.

| ID | Sev | Finding | Fix | Refs |
|---|---|---|---|---|
| D-1 | S2 | Two real tasks in one message are silently merged when ≥3-word titles overlap ≥80 % (e.g. "Send weekly status report to Rahul" / "…to Meera" → only one kept). Matches the prompt's own example. [post-build: v4 splitting] | Merge only on identical title, or title+quote+due; otherwise keep as a "possible duplicate" card and list dropped titles. | WF-004 |
| D-2 | S2 | An unreadable, zero-byte or schema-invalid record makes a to-do/proposal vanish; `corruptFiles` counter is never surfaced; atomic write lacks `fsync`. | fsync before rename; quarantine to `corrupt/` with a PMO banner; tolerant/migrating reads. | WF-005 |
| D-3 | S2 | Choosing the wrong inbox folder (Setup accepts any directory): the app moves every non-intake `*.json` out after 3 scans and deletes at 30 days. Reproduced: `package.json`, `tsconfig.json` parked within ~45 s. | Refuse/confirm for roots, Documents/Desktop/Downloads, folders already holding other JSON; use a marker file; never move foreign JSON. | WF-006 |
| D-4 | S2 | Reject is one click, no undo, and dedupe (`seen.json`, never pruned) blocks re-import forever; paste-again says "duplicate". | Restore list for rejected items or drop the seen entry; "Import anyway"; time-box manual-paste dedupe. | WF-007 |
| D-5 | S2 | Low-RAM "smaller model" path is a dead end: the fallback model downloads, but every AI call still asks for `gemma4:12b` (env-only config); Setup then offers only the 12 GB pull. "About 12 GB" is hard-coded for every model. **Read.** | Persist chosen model; auto-use the only installed model and say so. | WF-003 |
| D-6 | S3 | Working-copy sync deletes user files in `shared/roster*` unless extension is in a short list (`.xlsx .xlsm .xls .csv .json`): `.xlsb`, `.txt`, `.docx`, `.pdf`, `.ods` are removed on every engine start; config/reference are seed-once so shipped updates never reach existing installs. | Protect by directory; log removals; add a config schema-version hook. | WF-017, installer audit |
| D-7 | S3 | Engine run state is memory-only: crash/restart at a gate loses the run, orphans the Outlook draft, and re-running creates a duplicate draft. | Persist `run-state.json` per transition; restore `awaiting_*`; mark interrupted `working` as error so Retry resumes. | WF-019 |
| D-8 | S3 | Oversized (>1 MB), errored or held-back inbox files are invisible; PA bodies can exceed 1 MB. | Surface counts and names; truncate instead of skip. | WF-014, SBX-027 |
| D-9 | S3 | Quoted-chain stripping drops the real request in bottom-posted/inline replies (`"Hi Alwin,"` is all that reaches the model). | Keep non-trivial text after the chain; flag "reply may be below the quote". | WF-015 |
| D-10 | S3 | "Today" is hard-coded to IST in five places while reminders use the configured zone (NY example: 2026-10-26 vs 2026-10-25). An invalid hand-edited `timeZone` makes `/api/pmo/state` throw, taking the whole app down. DST maths verified correct. | One validated zone source (`safeTimeZone`) everywhere. | WF-012 |
| D-11 | S3 | Items due on a Monday never get an advance reminder with default settings (quiet-outside-hours + "previous calendar day"). | Previous *working* day, configurable lead. | WF-013 |
| D-12 | S3 | PMO polling cost grows with history (~2.6 ms/record; 1,500+500 records ≈ 4 s per 3 s poll; ~4 months at 10 items/day); proposals/to-dos never purged; `seen.json` rewritten whole. | Archive decided items, indexed/incremental state, `since`/ETag polling. | WF-016 |
| D-13 | S3 | All persisted UI state (Notes, pins, App Store installs, theme, "Not now") is in localStorage keyed to the origin including the **port**; if 3100 is busy the app runs on 3101 and everything looks reset. | Persist to userData via a small API, or log/notice on port change. | WF-010 |
| D-14 | S4 | Smaller consistency gaps: multi-task split writes card 1 `ready` before siblings (crash → "1 of 3" forever; reproduced) [post-build]; approve writes to-do then proposal (crash → duplicate to-do on re-approve); `saveInbox` bypasses the store lock; an exception in `onOk` is shown as a model failure. | See WF-033. | WF-033 |
| D-15 | S4 | Impossible dates (`2026-02-30`) accepted; intake contract says blank `sourceId` falls back to a hash but the schema rejects it (files get parked). | Real date round-trip; align contract and schema. | WF-032, WF-031 |
| D-16 | S3 | Update-card suggestions are ticked by default, so a hostile reply in a known thread is one "Apply" click from editing a to-do. | Default-off when the sender is not the requester/waited-on person or injection wording detected. | Workflow review (sound-areas note) |

### 3.4 UI, UX and performance (host GUI run)

| ID | Sev | Finding | Refs |
|---|---|---|---|
| UI-1 | S3 | **Drag/resize jank with many windows.** 10 windows: drag frame p50 46.9 ms, 59/93 frames >33 ms; resize p50 62.5 ms. One window: p50 15.6 ms, 0 slow frames. No long tasks, so paint/composite cost (translucent stacked windows). | SBX-014 |
| UI-2 | S3 | **Hardware acceleration toggle can be saved on a machine with no GPU compositing** (GPU status `disabled_software`/WARP): frame time 156 ms with 0 windows, 469 ms with 5; a 10-window drag took 45.8 s. The menu warns but allows it. Auto-fall back or refuse. | SBX-015 |
| UI-3 | S3 | **Default window is not clamped to the viewport.** At the app minimum 1024×720 the right edge (min/max/close) is off-screen; at 720 high the bottom sits under the command bar. Nothing re-clamps on resize/DPI change; windows can be dragged above y=0 with no handle. | SBX-016, WF-021 |
| UI-4 | S3 | **Notes:** a long first line becomes the title/aria-label (54k chars), widens the list and pushes every Delete button under the editor (real clicks hit the textarea). Copy says notes are "in memory only" but they persist; Delete has no confirm/undo; New note does not focus the editor. | SBX-017, SBX-023 |
| UI-5 | S3 | **Browser app:** non-URL input ("hello world search", `javascript:…`, `http://127.0.0.1:1/`) all show "blocks other sites from displaying it in a frame"; home page says "Search the web" but there is no search; check-embeddable returns 400 with console errors. | SBX-018 |
| UI-6 | S3 | Windows are not keyboard-operable; new windows take no focus; lock screen Tab moves to the dock behind it; Enter on a dock tile leaves focus on the tile. | WF-026, SBX-022, SBX-030 |
| UI-7 | S3 | Command-bar starter chips ("Open Notes/Files/Tasks") fail on an empty desktop ("Open an app first"). | WF-020 |
| UI-8 | S3 | Engine-down banner takes ~10 s to appear, has no inline Restart; renderer polls :8000 about every 1.3 s → 26 console errors in 35 s. | SBX-032 |
| UI-9 | S3 | PMO silent cases: duplicates leave no trace; "N parked in rejected-files" gives no path/list; non-`.json` files stay in the inbox forever; "Save settings" leaves the dialog open with a "Cancel" button and no confirmation; the "Pat Sample" quick pick commits immediately. | SBX-027, SBX-028 |
| UI-10 | S3 | Renderer crash leaves a blank window (no `render-process-gone` handler); keep-in-tray can block Windows sign-out/shutdown. **Susp.** | WF-024, CQ-011 |
| UI-11 | S3 | 1 of 3 relaunches after the hardware-acceleration toggle failed with `EADDRINUSE 127.0.0.1:3100` and exited with no window (another agent's instance may have held the port; unproven). | SBX-033 |
| UI-12 | S3 [post-build] | Force reset ~1 s into a Shift Roster run did not appear to stop it (still reached "Needs review"). Low confidence; this is what `a7af903` addresses. Retest. | SBX-026 |
| UI-13 | S4 | Maximised windows: "5 items" status bar sits under presence avatars; command bar overlaps window bottoms. Lean mode: translucent fill lets text from windows behind ghost through. "Server stopped" dialog prints exit code 4294967295. Setup dialog's "Check again / Done" are below the fold at default size. Task card says "3 of 3 required questions need an answer" while the dialog says "1 of 3" (also 4 of 4 vs 1 of 4). | SBX-020/021/024/029/031 |
| UI-14 | S4/IMP | Demo content shown as real: Files is a hard-coded mock tree, Browser mock pages, Notes seeds four sample notes, presence avatars are fake, "Spotlight" is a cursor glow (no search); windows do not persist across reload/restart; dock has two similarly named App Store entries and the desktop context menu has only "Refresh"; PMO To-Do (the real work app) is last in the dock; clicking a running focused app's tile opens another window. | WF-028, SBX-030/034/035 |
| UI-15 | S4 | Interactive AI jobs (chaser drafts, command bar) share the model with the background structuring queue; a command can time out behind a long structuring call. **Susp.** | WF-027 |

### 3.5 Performance numbers (host: 16 threads, 31 GB, 125 % DPI, lean mode, real Defender)

| Scenario | CPU | Memory | Notes |
|---|---|---|---|
| Idle desktop, 5 min 40 s | mean 0.47 % of one core (0.03 % of machine), max 3.2 % | ~711 MB total working set (renderer 240, main 136, Next 127, GPU 93, python 59, utility 57); JS heap 12.8–21 MB | 0 long tasks, constant layout count. |
| 10 windows, idle 45 s | mean 4.4 % of one core | ~1,155 MB (renderer 555) | |
| 60 rapid open/close | – | JS heap +6.3 MB, DOM back to 199 nodes | no leak. |
| Cold start | – | – | UI server 24–27 s (cap 30 s), engine 12–13 s (cap 20 s), main→engine-ready 38 s once; warm 2–3 s UI, 2.3 s engine, window 8–20 s. Setup self-test 35–54 s cold. |
| Engine restart / kill recovery / quit | – | – | menu restart 3.1 s; kill→recovered 11.7 s; quit leaves no process (2.3 s). Shift Roster start→first review gate 8–12 s. |

Idle behaviour is genuinely good; the issues are start-up time (R-1) and compositing cost with many windows or without a GPU (UI-1, UI-2). `TitlePrefix` runs a 1 s `setInterval` even when it does nothing in the desktop shell (CQ-016) — minor.

### 3.6 Background work and logs (IMP)

* Setup self-test (up to 300 s, in-memory result) re-runs on every Next start while the engine check is "unknown"; Ollama is started at every launch even if unused; Outlook probes every 5 min (WF-035).
* Unbounded logs: engine launch log gets uvicorn access lines every 2 s (`access_log=False`), `desktop.log` grows forever (476 KB after 5 weeks; 535 repeated next/font download warnings from live-dev), `audit.jsonl` never pruned (WF-034, CQ-012).
* Ollama install uses plain `fetch` (no Windows cert store/`HTTPS_PROXY` support, opaque error, restart from zero) — **Susp.** (WF-023).
* User data is under **Roaming** AppData (PMO raw message bodies, task inputs/outputs, logs); uninstall keeps it; may sync to a server in roaming-profile environments (WF-025).

---

## 4. Process review notes (what is sound)

Confirmed sound by reading and tests: ingest crash safety (raw → proposal → `seen` written before the inbox file is deleted; re-ingest after a crash neither loses nor duplicates), per-data-dir mutex across route bundles, prompt-injection containment (model output only becomes a draft; every to-do/update/sign-off needs a human click; sign-off recording is multiply guarded), timeout/garbage-output handling, DST/zone arithmetic in `due.ts`, reminder claim/ack with TTL, child-process cleanup (Next server and engine die with the shell even on hard kill; quit taskkills the tree), single instance, contextIsolation/sandbox, command injection (all spawns use fixed executables with argument arrays), path traversal guards (`isSafeId`, upload confinement — symlink variants were skipped on this host), Zustand selectors, timer/listener cleanup, iframe sandbox attributes, and no unused npm dependencies.

---

## 5. Code quality summary

| Check | Result |
|---|---|
| `pnpm typecheck` | Pass, 0 errors. |
| `pnpm test` | 1,099 tests, 253 suites. Run 1: 1 flaky failure (`pmo.server.test.mjs:587-598`, fixed 20 ms sleep, CQ-014); runs 2–3: 1,099/1,099. |
| Engine pytest | 413 passed, 8 skipped (symlink/junction tests: traversal defences not exercised on this host), 95 % coverage. |
| Per-task pytest | All pass; mailer suites parse `task.json` only (no Outlook run). Must be run with `python -m pytest` from the task folder (undocumented). |
| `pnpm lint` | **Fails: 22,085 problems**, all from `.claude/worktrees/**` and `agent-apps/.venv`; `eslint src` is 0/0. `desktop/**` is excluded from lint entirely. |
| `pnpm format:check` | **Fails: 81 files** (26 CRLF working-tree copies, 65 real drift); takes 75 s because it walks ignored folders. |
| `pnpm audit` | 1 critical, 12 high, 6 moderate (SEC-3). |
| Encoding | The "â€”" garbling is **not stored in any file** (0 hits, 0 BOMs); it appears when Windows PowerShell 5.1 or some editors read UTF-8 as cp1252. Real risk: Python `read_text()` without `encoding=` on Windows (`tasks-engine/main.py:207,607,664`) and `discover_tasks()` aborts engine import on one bad manifest (CQ-013, CQ-044). |
| Legacy names | No code references to agent-office/`agent.json`/`useAgentOffice`; one stale docstring in `prepare_data.py:500`. Old `agent-apps/` folder (gitignored, holds real files and a `.venv`) is what breaks `pnpm lint`; delete only with your say-so. |

Quick wins (each under an hour): extend ESLint/Prettier ignores (CQ-020) and run `pnpm format` once (CQ-022); strip `NODE_TLS_REJECT_UNAUTHORIZED` (CQ-005); bump `next`/`zod` (CQ-006); one `middleware.ts` + `headers()` block (CQ-003/004); non-fatal engine start + splash (CQ-009); poll instead of 20 ms sleep in the flaky test (CQ-014); move `restarting` out of the replaced `ui` object (CQ-010 race: a second restart can start during the engine wait); `encoding="utf-8"` and `PYTHONUTF8=1` (CQ-013, CQ-044); fix the data-path docs and the README intro (CQ-040/041).

Deletion candidates (about 330 source lines, safe unless noted): `pmo-todo-app/index.ts` (unreachable), ~130 unused lines in `src/lib/tokens.ts`, `toFromApprover`, `TASK_KINDS`, `--dur-fast/--dur-slow`, dead Python names (`label_of`, `REVIEW_REASON_HEADER`, `RESOLVED_NOTE`, `_is_date`, `SHIFT_CODES`, `PLAN_HEADER_ROWS`, `_n_text`), and `tasks/monthly-report-deck/scripts/diff_workbooks.py` (confirm it is not a hand-run debug aid). Medium confidence: `src/app/design/*` dev gallery (404s in production but still compiled), `PMO_AI_STUB` generator reachable in production. Duplicated helpers worth consolidating: `formatBytes` ×3, `plural` ×5, `useNow` ×2, `sleep` ×4, clipboard "copied" flash ×6, and `december-disconnect`/`shift-roster` `_common.py` (22 shared names, only 8 identical). Oversized: `tasks-engine/main.py` (2,053 lines, worth splitting), `ai-runtime/core.ts` (1,069), `desktop/main.cjs` (1,014).

Documentation: README still describes the "foundation layer"; ARCHITECTURE says PMO prompt v3 (code is v4, and `splitTasks` is undocumented) and lacks a desktop-shell/security section; six undocumented env vars (`AI_OS_AI_MAX_OUTPUT_TOKENS`, `AI_OS_PMO_AI_TIMEOUT_MS`, `AI_OS_PMO_SCAN_MS`, `AI_OS_REMINDER_FIRST_MS`, `AI_OS_REMINDER_POLL_MS`, `PMO_AI_STUB`).

Test tooling findings (`scripts/clean-machine/`; fixed in the repo scripts after this report, SBX-002 to SBX-010 and see `docs/clean-machine-test.md`; the new-laptop bundle keeps its own copy): no policy preflight and a 25-minute wait (SBX-002); stale `results.json` path mismatch (SBX-003); `-KeepOpen` breaks guest args (SBX-004); sandbox never shut down (SBX-005); `-LaunchApp` can pass on a stale `desktop.log` and uses real app data on a non-fresh profile (SBX-006); PS 5.1 treats a Python stderr line as a failed self-test (SBX-007); file-count baseline taken after the self-test, `python.exe` used instead of `pythonw.exe` (SBX-008); missing Track A checks (SBX-009); no managed-PC warning in the doc (SBX-010); the command bar has no deterministic stub (SBX-011).

---

## 6. Improvements (not bugs), ranked by value / effort

1. Window and splash first, engine non-fatal and in the background (R-1) — high / low.
2. One "Needs attention" strip in PMO: unreadable records, oversized or locked files, ingest errors, queue paused, model missing (D-2, D-8) — high / low.
3. Restore for rejected items and "Import anyway" for duplicates (D-4) — high / low–med.
4. First-run wizard: who are you, time zone, allowed domains, create `PMO-Inbox` (R-3) — high / med.
5. Persist the chosen AI model; auto-use the fallback if it is the only one installed (D-5) — high / med.
6. Per-launch token, Origin/Host checks and engine instance id (SEC-1/2) — high / med.
7. Archive decided proposals and closed to-dos; incremental state (D-12) — high / med.
8. Confirm dialogs echoing recipients/subject for Send, confirm Force reset mid-run (SEC-8) — med-high / low.
9. Persist engine run state so a crash resumes at the gate (D-7) — med-high / med.
10. One validated time-zone source (D-10); due-soon on the previous working day with configurable lead (D-11) — med / low.
11. Keep text below a quote in reply handling (D-9) — med / low.
12. Recurring to-dos are display-only; offer the next occurrence on "done" — med / med.
13. Move Notes/pins/theme to userData; data to `%LOCALAPPDATA%` (D-13, WF-025) — med / med.
14. In-app "Run Outlook export now" plus a Task Scheduler recipe (R-10) — med / med. *Done without the button: the installer now ships `pmo-intake/scripts/*.ps1` (to `resources\app\pmo-intake\scripts`) and `pmo-intake/HOW-TO-GET-STARTED.md` has a `schtasks` recipe; Power Automate remains the alternative.*
15. Model queue priority lane and "waiting behind N items" (UI-15) — low-med / med.
16. Log rotation, `access_log=False` (Section 3.6) — low / low.
17. Update mechanism (none today; every upgrade is a manual installer run) — med / high.
18. Dry-run/report for workcopy sync ("this start removed 3 files") (D-6) — low-med / low.
19. Keyboard-operable windows (role/label, focus on open/restore, Ctrl+W) (UI-6) — med / med.

---

## 7. Questions for you

1. Will anyone besides you install AI OS? (Decides R-3 defaults and whether multi-user hosts matter for SEC-2.)
2. Task data on a fresh install (R-2): ship empty configs, or add an import step? What is the migration story for 1.0.0 / agent-office data (none exists today)?
3. Should the dedupe index be permanent; should rejected messages be restorable and identical pastes allowed later (D-4)?
4. Must the shell start when the Tasks engine cannot (R-1)? I assumed no.
5. Which model on a low-RAM machine, and should AI OS choose it (D-5)?
6. Due-soon: previous calendar day or previous working day (D-11)?
7. Should recurring to-dos regenerate on completion?
8. Where should user data live (Roaming vs Local), should uninstall offer to remove it, and is raw message text outliving the retention setting after uninstall acceptable?
9. "Window persistence across restart" and "spotlight/search" are in the plan checklist but do not exist. Intended features?
10. Is the lock screen meant to be real security?
11. Should Files, mock Browser pages and seeded Notes ship in production?
12. Are `deloitte.com` and subdomains the only sender domains you receive from (other member-firm domains are quarantined by default)?
13. Keep-in-tray: should it never block Windows sign-out/shutdown?
14. Do you want near-identical tasks merged at all (D-1), or shown as "possible duplicate" cards?

---

## 8. Coverage (host GUI run unless stated)

**Pass:** wallpaper, login (see UI-6), dock launch and running indicators, window open/focus/drag/resize/minimise/maximise/close/z-order (see UI-1/3/13), context menus and tooltips, light/dark/brand themes (persisted), lean mode, hardware-acceleration toggle and relaunch (see UI-2/11), Settings, tray hide/restore, single instance, close vs quit, command bar with Ollama missing (clear error naming URL and model), model status card and log, Setup dialog card states (host state plus emulated Ollama-down; self-test ran automatically; reopen from Settings), Files (mock), App Store install/open, Browser embeddable and fallback, PMO ingest and 4 s scan, stub structuring, review queue and proposal dialog, filtered tab with reasons and Allow, manual paste, to-do edit/due/priority, waiting-on, reports and narrative save, dedupe (silent), degraded "waiting for model" retry, Tasks list/detail/log/history, run to first gate (shift-roster and december-disconnect, after seeding config), Reject, engine restart, engine-kill recovery, engine stop on quit, data under app-data and `shared/` protection, UI-server crash restart via native dialog, paths with spaces/apostrophe/non-ASCII, rapid open/close and 10+ windows, second launch, quit cleanup, keyboard/focus basics, DPI 100/125 real.

**Fail / defects:** splash and start-up time (R-1), window persistence (not implemented), Notes (UI-4), Browser input handling (UI-5), Shift Roster / December Disconnect on a fresh profile (R-2), PMO silent cases (UI-9).

**Inconclusive:** Force reset mid-run (UI-12, post-build).

**Not tested:** App Store uninstall, taskbar reorder/unpin, notifications/toasts, reminders, chasers, sign-off, Outlook export, Done/cancel/snooze/delete on to-dos, approve past the first gate, config editing in Tasks (not present in the UI), port selection skipping busy ports, off-screen windows, offline, DPI 150/200 live (200 % emulated; one screenshot reviewed), AI cursor/annotations/handoff glow (no model path or stub for the command bar), real inference, Setup install/download/cancel/resume/low-RAM/proxy/Browse (buttons deliberately not pressed), App Store detail view (not found).

**Blocked, needs clean machine / real network:** install, uninstall, reinstall over the top, upgrade from 1.0.0, no-Ollama first run on a clean profile, no-network, proxy, SmartScreen/Smart App Control/AppLocker behaviour, cold-start timing on the new laptop, Ollama install, 12 GB model download, OneDrive/Outlook/Excel presence, ARM64. These are covered by the new-laptop bundle (below).

---

## 9. Recommended order of work

1. **Before rebuilding (one packaging pass):** R-1 (window first, non-fatal engine, longer budgets, splash), R-2 (decide and implement task-data delivery), R-3 (first-run identity/inbox, no auto-consume), R-6 (scrub `PYTHON*`), R-7 (installer kill list), R-8 (data-folder docs), SEC-1 minimum (token or at least origin check on the engine and `/api/tasks-engine/*`), SEC-3/SEC-4 (bump `next`/`zod`, strip TLS override), D-3 (inbox folder sanity check), D-5 (persist model), D-1/D-2/D-4 (data-loss fixes). Include `a7af903` and `6dba299` (already on master).
2. **Rebuild**, then run the bundle on this host in `-AppDir` mode again and on the new laptop for real.
3. **On the new laptop:** `.\Run-InstallerCheck.cmd -Installer "D:\AI OS Setup 2.0.0.exe" [-PreviousInstaller "D:\AI OS Setup 1.0.0.exe"]`, then `new-laptop-bundle/MANUAL-CHECKLIST.md` in order (Setup cards, Ollama install, model download, PMO inbox, Outlook, Tasks with a roster copy, reinstall-over-top, quit cleanliness). Quit AI OS on the old laptop first (R-3). Copy the task data listed in the checklist (step 10) by hand until R-2 is solved.
4. **Next iteration:** UI-1/2/3 (window performance and clamping), UI-4/5/8/9 (Notes, Browser, banner, PMO silent cases), SEC-8 confirmations, D-6/D-7/D-10…D-13, tooling cleanups (ignore lists, format pass, README/ARCHITECTURE refresh, installer weight).

---

## 10. Appendix: finding index by source

* **Workflow review (WF):** 001→SEC-1 · 002→R-1 · 003→D-5 · 004→D-1 · 005→D-2 · 006→D-3 · 007→D-4 · 008→SEC-2 · 009→R-1 · 010→D-13 · 011→R-3 · 012→D-10 · 013→D-11 · 014→D-8 · 015→D-9 · 016→D-12 · 017→D-6 · 018→SEC-8 · 019→D-7 · 020→SEC-7/UI-7 · 021→UI-3 · 022→SEC-9 · 023→3.6 · 024→UI-10 · 025→3.6 · 026→UI-6 · 027→UI-15 · 028→UI-14 · 029→SEC-6 · 030→SEC-5 · 031/032→D-15 · 033→D-14 · 034/035→3.6.
* **Code quality (CQ):** 001→SEC-1 · 002→SEC-2 · 003/004→SEC-1 · 005→SEC-4 · 006→SEC-3 · 007→SEC-5 · 008→SEC-6 · 009→R-1 · 010–017 §5 · 020–022 §5 · 030–039 §5 · 031→R-9 · 040→R-8 · 041–045 §5.
* **Host run / tooling (SBX):** 001–011 §5 · 012→R-2 · 013→R-3 · 014→UI-1 · 015→UI-2 · 016→UI-3 · 017→UI-4 · 018→UI-5 · 019→R-1 · 020–024, 029, 031→UI-13 · 025→SEC-8 · 026→UI-12 · 027/028→UI-9 · 030→UI-6/14 · 032→UI-8 · 033→UI-11 · 034/035→UI-14.

Per-source raw findings (with file:line pointers) were returned by the three review agents and are consolidated above; the installer audit's full notes with Verified/Inference tags are in `new-laptop-bundle/AUDIT-NOTES.md`.
