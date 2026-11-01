# Prompt: rename to PMO Desk, new logo, AI glow + cursor

Paste everything below the line into Copilot Chat (agent mode, Claude Sonnet 5.5). Attach these files for context:
`docs/marketing/pmo-desk-launch.html`, `docs/marketing/logo/README.md`, and the files in `docs/marketing/logo/`.

---

You are working in the repo at `C:\Projects\AI OS`. Do three jobs, in order, as separate commits on the current branch. Read before you edit, and show me a short plan first.

## Reference material (already in the repo, do not edit)
- `docs/marketing/pmo-desk-launch.html` is the approved visual reference. Open it and read its CSS and markup for: the logo (inline SVG in the dock and hero), and the "AI glow" mock-up (search for `.glowwrap`, `glowrot`, `.cursor`, `#gcur`, `.bubble`, `#gbub`, "AI is working").
- `docs/marketing/logo/` holds the final logo: `mark.svg`, `mark-dark.svg`, `mark-mono.svg`, `wordmark.svg`, `wordmark-dark.svg`, `mark-512.png`, `mark-32.png`, `README.md` (concept: a "P" made from a queue of fading pills plus a ring with a tick, on a deep-teal tile).
- New product name: **PMO Desk**.

## Job 1: Rename "AI OS" to "PMO Desk"
Rename everything the user can SEE: window title, Help > About, tray/taskbar text, installer wizard text (`build/installer.nsh`: welcome, finish, "Open ..." run text), `productName`, `shortcutName`, first-run "Set up ..." screen, login screen, README, UI copy, toasts, error messages, and the artifact/installer file name (`PMO Desk Setup x.y.z.exe`, `PMO Desk.exe`).

DO NOT rename these. They hold existing installs and real data, and a rename would orphan it. Keep them, and add a one-line code comment next to each saying why:
1. **The user-data folder `%APPDATA%\ai-os`** (PMO records, config, audit log, tasks-engine data). First find how Electron derives it today. Then pin it explicitly, e.g. `app.setPath('userData', ...)`, so changing `productName` cannot move it. Prove with a test or a printed path that `userData` is still `%APPDATA%\ai-os`.
2. **The OneDrive folder `AI-OS` and its `PMO-Inbox` subfolder.** Live Power Automate flows write into it; renaming it silently breaks intake. Leave the path as is.
3. **`appId` (`com.aios.desktop`)**. Changing it makes the installer treat this as a different app (side-by-side install, old one not upgraded). Keep it. Check that the NSIS upgrade path (install folder `%LOCALAPPDATA%\Programs\AI OS` -> new folder name) still upgrades in place or cleanly migrates; if the install dir name changes, handle the old dir (uninstall or migrate) so users do not end up with two copies and two shortcuts. Flag the trade-off to me before choosing.
4. Internal identifiers that are not user-visible: env vars (`AI_OS_*`), the `X-AI-OS-Token` header, `package.json` `name`, repo folder name, NSIS macro names. Leave them unless renaming is trivially safe; list what you left and why.

Then grep the whole repo (excluding `node_modules`, `.next`, `release`, `.claude/worktrees`, `agent-apps`) for `AI OS`, `AI-OS`, `ai-os`, `aios` (case-insensitive) and give me a table: renamed / intentionally kept (with reason). Visible text must have zero matches.

## Job 2: New logo
Replace the current logo everywhere it appears, using the SVGs in `docs/marketing/logo/` (copy them into the app's assets; do not redraw):
- UI: dock/taskbar brand mark, login screen, the "Set up PMO Desk" screen, About, any empty states.
- Browser tab: favicon and `app/icon`/`apple-icon` (Next.js metadata).
- Electron: window icon, tray icon, taskbar icon. Generate a multi-size `.ico` (16/24/32/48/64/128/256) from `mark.svg` for Windows (e.g. with `sharp` + `png-to-ico` as dev scripts; commit the generated `.ico`/`.png`, not the toolchain).
- Installer: NSIS installer/uninstaller icon and the welcome/finish sidebar and header bitmaps if the installer uses them (`build/`).
Use `mark-dark.svg` where the background is dark and `mark-mono.svg` where a single colour is required. Make sure the mark is crisp at 16 px (check the 16 and 32 px renderings; if the three pills and tick blur at 16 px, make a simplified small-size variant and say so).

## Job 3: AI glow border + AI cursor, exactly as the HTML mock-up shows
Today `src/components/window-manager/AIGlowBorder.tsx` (+ the `ai-ring` utility in `src/app/globals.css`) and `src/components/ai-layer/AICursor.tsx` / `AIAnnotationBubble.tsx` exist, but they do not match the approved look in `pmo-desk-launch.html`. Make the real app match the HTML, exactly:

**Glow border** (shown when `controlledBy === "ai"`, mounted by `Window.tsx`):
- A soft, blurred, multicolour conic-gradient halo that sits just OUTSIDE the window edge (the HTML uses `inset: -6px`, radius +6px, `filter: blur(16px) saturate(1.25)`, opacity about .85) with colours blue -> violet -> magenta -> pink -> red -> orange -> amber -> pink -> blue, and the gradient angle rotating continuously (about 8 s per turn) via a CSS `@property --glow-angle` animation. Copy the exact stops from the `.glowwrap::before` rule.
- It fades in over about 0.4 s when the AI takes control and fades out when control returns to the user. It never intercepts pointer events, sits below the window content but above neighbouring windows, and is not clipped by the window's rounded `overflow-hidden` (keep it a sibling of the chrome, as the current component does).
- Rotation uses only the CSS animation (no React re-renders per frame). Under `prefers-reduced-motion` it shows as a still ring. Check it with 3+ windows open and with maximized/snap states, and check the cost: no visible frame drops while dragging another window.

**AI cursor** (`AICursor.tsx`):
- Match the HTML cursor: a dark (`#14171c`) pointer with a white 1.5 px stroke and a soft drop shadow (see `.cursor` and the `#gcur` path), gliding with the existing spring so it reads as an agent chasing a point, not a teleport. Replace the current accent-filled pointer. Keep it portal-rendered, `pointer-events-none`, always mounted and fading its opacity, as the current component's comments explain (do not switch to mount/unmount).
- Keep a small name-tag chip next to the pointer only if the HTML mock-up has one; otherwise follow the HTML. Use the app's existing tokens for the chip, not new colours.

**Annotation bubble** (`AIAnnotationBubble.tsx`):
- Match the HTML `.bubble`: a rounded (16 px) glass card with a 1 px glass-edge border, 13 px semi-bold text, max width about 230 px, popping shadow, that fades (about 0.22 s) when the text changes, e.g. "Opening the Review Queue for you.".
- The window title bar shows an "AI is working" chip with the spark icon, as in the mock-up's `.chip.ai`. Add it to the window chrome for AI-controlled windows, and remove it when control returns.

**Behaviour (keep what the app already does):** control can be handed back to the user with one click, and the glow, cursor and bubble all clear when that happens. Do not change the agent-handoff logic in `agentStore.ts`, only the visuals.

## Rules
- Never run `git add -A` (untracked `agent-apps/` holds real task data and a 671 MB venv). Stage only the files you changed. Do not push. Do not delete any branch.
- Never delete, move or write real user data under `%APPDATA%\ai-os` or the OneDrive `AI-OS\PMO-Inbox` folder. For any smoke test, use a temp user-data dir and redirect the inbox dir (`AI_OS_PMO_DATA_DIR`, `AI_OS_PMO_INBOX_DIR`), or the app will ingest and delete real PMO inbox items.
- Do not trigger any mutating action in the Tasks engine (no sends, no POSTs to the engine's send/draft endpoints) while testing.
- Run `pnpm typecheck`, `pnpm lint` and the unit tests; they must pass. Verify the glow and cursor in a running dev build with a screenshot in light and dark mode, then tell me exactly what you verified and what you could not (do not claim a visual match you did not look at).
- Do not rebuild or reinstall the packaged app unless I ask. If you think a rebuild is needed to verify the installer text and icons, tell me and wait.
- Finish with a summary: files changed, what was kept and why, and anything that needs my decision (especially the install-folder/appId trade-off).
