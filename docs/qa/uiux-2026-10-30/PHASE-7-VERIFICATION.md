# Phase 7 - verification results (1 Nov 2026)

Branch `feat/uiux-overhaul`. Verified on the desktop app (`electron .`, live-dev) with dummy data, plus the full automated suite.

## Automated checks (merged branch)
| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| Unit/integration tests (`src/**/*.test.mjs`, `desktop/*.test.cjs`) | 2906 pass, 0 fail |
| ESLint (`src`, `desktop`) | clean (run with `NODE_PATH` set to the `eslint-config-next` dependency folder, see the plan) |
| Prettier on changed files | clean |
| Production compile (`next build`, webpack) | passes. `next build --turbopack` cannot run on this PC only because `tasks/deployment-dep-weekend-mailer/.pytest_cache` is an unreadable folder left by an earlier run (access denied, cannot be removed without elevation); it is untracked and unrelated to the branch |

## Visual and layout sweep (script-driven, per app)
Ten apps x four theme combinations (light, dark, Deloitte, dark + Deloitte) and the 1024x720 minimum size. Per window the sweep measured horizontal overflow, clipped text, off-window elements and text contrast. Screenshots: `after/phase7/`.
- Light, dark, Deloitte: no overflow, clipping or contrast failures.
- Dark + Deloitte: inactive tab and chip labels were 4.4:1 (AA needs 4.5:1). Fixed by lightening `--color-neutral-600` for that theme; re-run is clean.
- 1024x720: no overflow or clipping in any app. One real defect found by eye: in the PMO review pane the "scroll the quote into view" call scrolled the whole pane and hid the draft fields. Fixed (it now scrolls only the message box).

## Accessibility spot check
- No button, tab, switch or link without an accessible name in any of the ten apps; no unlabeled inputs.
- Esc closes the Add-employee dialog.
- Click targets under 24 px: chip remove buttons (14 px) and carousel dots (7 px) were enlarged. Other small items are inline text links.
- Not done: a screen-reader pass and a full keyboard-only walkthrough.

## Interaction checks done in the running app
- Command bar Stop (QA-20): clock and hint appear, Stop/Esc cancels and shows "Stopped." The status text was cut off mid-word; shortened.
- Browser (QA-42): example.com reports "Can't reach" on this PC because Node's TLS revocation check is blocked on the corporate network while the site is reachable in PowerShell. The wording now says a work-network proxy can cause this and offers Retry and "Open in default browser". The "site refuses framing" message could not be exercised on this network.

## Status of QA-01..44
Legend: **App** = seen working in the running app; **Test** = covered by unit/server tests and code review, not seen on screen.

| QA | Status | QA | Status |
| --- | --- | --- | --- |
| 01 Tasks launcher retry | App (opens and loads); retry/back-off Test only, the original 404 was not reproduced | 23 Add dialog internal path | Test |
| 02 PMO setup validation | App | 24 Time off wording | App ("Total", "PTO emails - Model asleep") |
| 03 Ctrl+K loading | App (results appear); loading/failed-source states Test only | 25 Time off row actions | App (cards, labelled actions); undo Test |
| 04 Calendar current week | App | 26 Add time off errors | Test |
| 05 Opaque dialogs | App | 27 Dashboard cards | App |
| 06 Email wrapping | App | 28 PMO wizard | App (stepper, empty name) |
| 07 Directory columns/rows | App (also at 1024x720) | 29 Teams under Advanced | Test |
| 08 Roster legend/toolbar | App | 30 Review loading states | Test |
| 09 Capacity | App | 31 To-do footer | Test |
| 10 Org chart | App | 32 Reports empty state | App |
| 11 Fallback titles | App (queue titled by subject) | 33 Run dialog | Test |
| 12 Owner default | App ("Alex Morgan") | 34 History empty state | Test |
| 13 Status chips | App | 35 Packs layout | Test |
| 14 To-do controls | App | 36 Schedule table | Test |
| 15 Stale tooltip | App (fixed after wave 1) | 37 Templates toolbar | App (More menu, 2x2 pills) |
| 16 Templates To/Cc | App (chips) | 38 Toolkit in place | App ("All tools" back) |
| 17 RAID empty state | App | 39 RAID row actions | Test |
| 18 RAID form errors | Test | 40 Files selection/font | Test |
| 19 Files demo label | App | 41 Notes titles | App |
| 20 Command bar Stop | App | 42 Browser messages | Test (wording changed; see above) |
| 21 New person into view | Test | 43 App Store install | App (Demo chips); install flow Test |
| 22 Toast placement | Test | 44 Activity labels | Test |

## Known limitations
- Dark/Deloitte themes were swept automatically for every app, but only a few screens were inspected by eye.
- Performance was not re-measured against the earlier QA baselines.
- The installer/`electron-builder` packaging was not rebuilt.
