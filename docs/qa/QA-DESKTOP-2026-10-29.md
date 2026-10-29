# Desktop QA pass, 2026-10-29

Driven over the DevTools protocol against the real desktop app (`electron .`, once in `live-dev` and
twice in `live-build`), on the real profile and the real OneDrive/Power Automate folders, using
`alsaju@deloitte.com` and `skarunakaran@deloitte.com` as the test people. Screenshots were taken in
all four theme combinations (dark/light x default/Deloitte). Test data created along the way (a PTO
email, a pasted message, a to-do, an approved leave) was removed afterwards; the only change kept
is Selva's refreshed Microsoft 365 profile.

## Fixed

| Area         | Finding                                                                                                                                                                          | Fix                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal     | `next/font: Failed to download Figtree / IBM Plex Mono / Open Sans from Google Fonts` on every dev start behind the proxy, and the UI silently fell back to Arial/Segoe.         | Fonts are bundled from `@fontsource*` through `next/font/local` (`src/app/layout.tsx`). Works offline, no warnings.                                       |
| UI           | The Next.js dev "N" badge floated over the shell's bottom-left corner.                                                                                                           | `devIndicators: false` in `next.config.mjs`.                                                                                                              |
| Performance  | First open of Staff / PMO in `live-dev` waited 1-6 s while Turbopack compiled each API route.                                                                                    | `desktop/dev-warmup.cjs` requests the read-only routes in the background after a `live-dev` start (tested in `dev-warmup.test.cjs`).                       |
| Performance  | Unlocking the lock screen ran at about 8 fps with hardware acceleration off (a full-screen blur, scale and backdrop saturation over the wallpaper).                              | Lean mode now fades only the scrim and card; the identical wallpaper beneath stays put. Worst frame 125-141 ms -> 63-78 ms, transition 670 ms -> 410 ms.  |
| UI           | Setup dialog: the sticky footer stopped 28 px short of the bottom, with a strip of the last card showing below it.                                                               | `sticky -bottom-7` (a sticky offset is measured from the padding edge).                                                                                   |
| UI           | Add employee dialog broke the OneDrive path mid-word (`Staff-Exchang` / `e`).                                                                                                    | The path wraps after each `\`.                                                                                                                            |
| UI           | Native scrollbars with arrow buttons in dialogs and tables clashed with the themed ones.                                                                                         | Slim themed scrollbars by default (`@layer base` in `globals.css`); `scroll-thin` and `[scrollbar-width:none]` still win.                                 |
| UI           | Shift roster had two "Today" controls (jump to today, and the day view).                                                                                                         | The day view is labelled "Day".                                                                                                                           |
| UI           | Notes list showed `Aug 12, 2026 -- - Shipped the...` when a note started with a bullet.                                                                                          | The preview drops a leading list marker.                                                                                                                  |

## Verified working

- Staff: directory, add by email (duplicates skipped, invalid addresses reported), edit, Refresh from M365
  (request file -> flow -> profile applied in about 30 s), shift roster (day/week/month/cycle), time off
  (validation, overlap check, approve), offboarded tab.
- PTO email flow: a `pto-mail/1` file dropped in `PTO-Inbox` became a pending PTO for the right
  person with the right dates; an unknown sender went to `rejected` with a reason.
- PMO To-Do: new to-do, detail dialog, cancel; paste a message -> structured to-do draft with a verified quote.
- Tasks, App Store, Notes, Browser, Setup and health check, the command bar, window drag/resize/maximize.
- All four theme combinations are uniform: same layout, spacing, states and accent mapping.
- Production build (`live-build`): API calls 7-15 ms, idle CPU 0 %, window open/close worst frame 47-78 ms.
  Full suite: 1831 unit tests, typecheck, lint and Prettier clean.

## Open (not changed here)

1. **Local model speed (biggest wait).** `gemma4:12b` runs on the CPU (0 B in VRAM) on this machine:
   about 4 tokens/s, a 68 s cold load, and 150-180 s to structure one short pasted message. Options: a
   smaller model for `structure` (`qwen2.5:7b-instruct-q4_K_M` is already installed), a shorter prompt, or
   a longer `keep_alive` while the Staff/PMO windows are open.
2. **Polling stops while the window is hidden.** Staff sync and PTO processing only run while the window is
   visible, so a PTO email dropped while the window is covered waits until it is uncovered. Intended
   (commit 5c3caf6), but worth knowing when testing.
3. **Tasks engine cold start** took 15 s once after a long idle (2 s normally).
4. Month view of the shift roster needs horizontal scrolling in a window narrower than about 1100 px.
5. A to-do cannot be hard-deleted from the UI; "Cancel to-do" keeps the record.
