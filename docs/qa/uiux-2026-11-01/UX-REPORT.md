# PMO Desk: UX test report (1 Nov 2026)

Build tested: production build of `feat/pmo-desk` (`e7becb9`) in the desktop shell, with seeded demo data (12 staff, 8 leave requests, a roster, 8 to-dos, 5 PMO inbox items). Screenshots are in [screenshots/](./screenshots).

## Summary

| | Count |
|---|---|
| Regressions from my recent changes, fixed in this round | 1 |
| Improvements proposed (need your approval) | 11 |
| Automated checks with no findings | layout, clipping, contrast, horizontal scroll, accessible names (10 apps x 4 looks) |

Nothing is broken in the main journeys. Every journey I ran worked (see "What I ran"). The proposals below are polish and consistency.

## Fixed this round

### F1. Quick settings menu ran off the bottom of the screen (regression from moving Settings into the App Menu)
The menu was 723 px tall and ended at y=871 on an 850 px viewport. It did not scroll, so "Setup and health check" was clipped, and on shorter screens several rows were unreachable.
- Fix: the menu now caps its height to the space available and scrolls ([SettingsMenu.tsx](../../../src/components/desktop/SettingsMenu.tsx)).
- Verified on a rebuilt production app: the menu now ends at y=836 on an 850 px viewport, all rows visible. Evidence: `screenshots/fix-menu.png`. I did not test a viewport shorter than 850 px after the fix.

## Proposed improvements (for your approval)

Priority: **P1** = worth doing next, **P2** = polish.

| # | Pri | Area | Finding | Suggested change | Evidence |
|---|---|---|---|---|---|
| U1 | P1 | Windows | Maximize now fills the screen, but snapped halves still keep the old 88 px top and bottom gutters (697x666 at y=88). The two behaviours look inconsistent next to each other. | Give snapped windows the same zero insets as maximize (one constant: `windowDefaults.insets` used by `snapWindow`), keeping the command-bar bottom padding. | `sn-2.png` |
| U2 | P1 | App Menu | Opening Settings drops a 21 rem menu over the App Menu and hides the app grid it came from. | Anchor the quick settings to the left of the App Menu, or open it as a second column beside it. | `fix-menu.png` |
| U3 | P1 | PMO To-Do setup | Placeholder text ("Alsaju", "deloitte.com") looks like real input, yet validation says the field is empty. Step 1 also says "Welcome back: your earlier answers are filled in" when nothing is filled. The red errors sit under the form, not under the field, and are not linked to the inputs (`aria-invalid` and `aria-describedby` are missing). | Use a clearly lighter placeholder, or pre-fill the suggestion as real, editable text. Show the "Welcome back" line only when saved answers exist. Put errors beside their fields and link them for screen readers. | `w2.png`, `w-t3.png` |
| U4 | P1 | PMO To-Do setup | On step 4 "Finish setup" is below the fold; you have to scroll the summary to find it. The step content also jumps vertically between steps because it is centred. | Pin the Back/Next/Finish row to the bottom of the window and top-align the steps. | `w-u2.png`, `w-t2.png` |
| U5 | P2 | Tasks | At 1024 px wide, workflow names are cut to "December ...", "Deploymen...", "Monthly Re...". | Allow two lines for the name, or use two columns below 1100 px. | `sheet-sm-a.png` |
| U6 | P2 | Staff directory | Long names and portfolios are cut ("Sofia Hernandez-Montgomery-...", "Technology & Transf..."), and headers like "LOCATI..." are cut at 1024 px. | Show the full value in a tooltip, and let Offering portfolio and Location columns size to content. | `sheet-sm-a.png`, `sheet-mx-a.png` |
| U7 | P2 | Settings and wizard | In a wide window the content is a narrow centred column with large empty sides. | Left-align with a settings sidebar, or let the window open narrower. | `ks-1.png` |
| U8 | P2 | Home screen | With no windows open the desktop is only a logo. Nothing tells a new user what to do or what needs attention (the "Who's out today" card is off by default). | An optional "Today" card or three suggested commands next to the logo. | `j-home.png` |
| U9 | P2 | PMO Toolkit | Card grids end with orphan cards (3 + 1 in both sections). | Use a 2- or 4-column grid, or make the last row span. | `sheet-sm-a.png` |
| U10 | P2 | Review Queue | The proposed to-do form scrolls inside a small region of the detail card while empty space remains below it. | Let the detail pane scroll as a whole and keep Approve/Reject pinned. | `pt-2.png` |
| U11 | P2 | Hit targets | Some targets are under 24 px: Dashboard person links (20 px high), Staff column headers (21 px), App Store carousel dots (12x24 px). | Pad them to 24 px or more. | `a11y.mjs` output |

## What worked well
- Command bar: "Who's off this week?" answered in a card with Copy and "Show me in Staff"; the "AI model is asleep, Wake it now" hint is clear (`j-cmd-q1.png`).
- Approving a review item moves to the next one and updates the counts (`pt-4.png`).
- Maximized windows fill 1426x850 in every app; the command bar sits over them with the hue (`sheet-mx-a.png`).
- Light, dark, Deloitte-light and Deloitte-dark all rendered cleanly across the ten apps (`sheet-D0-a.png`, `sheet-D1-a.png`).
- Keyboard: Esc closes dialogs and Ctrl+, opens Settings (`ks-1.png`).
- Setup wizard completion screen explains what happens next (`pt-1.png`).

## What I ran
- All ten apps in light, dark, Deloitte-light and Deloitte-dark at the default size, and maximized at 1426x850 and 1024x720. The automated audit found no clipped text, horizontal scroll or contrast failures. The "offscreen" hits are window resize handles. Maximized "under the command bar" hits were scrollable content and are reachable by scrolling; I judged them from `sheet-mx-a.png` and `sheet-sm-a.png`.
- Accessible-name and target-size audit on every app.
- PMO To-Do: full setup wizard, Review Queue, approve, To-Do list, Board.
- Staff: Time off, Shift roster, Insights.
- Command bar question, App Menu, Quick settings, Settings dialog (Ctrl+,), drag-to-snap.

## What I did not test
- Lock and unlock round trip, reduced motion, Alt+Tab, Add employee form, window resize and minimize/restore.
- Real AI answers: the model was asleep, so the command bar used the built-in test stub.
- Smoothness with hardware acceleration on (the app defaults to software rendering and all frame timing was measured in that mode).
- The packaged installer was not rebuilt, so installer text, icons and the upgrade from the old install folder are still unverified.

## Decisions needed
1. Which of U1-U11 to build. My suggestion: U1-U4 first.
2. The install-folder trade-off from the rename round: existing installs stay in `Programs\AI OS`, fresh installs use `Programs\PMO Desk`. Say if you want a migration, and whether I should rebuild the installer to verify.
