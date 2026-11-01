# UI/UX implementation plan

Scope: the 44 fixes (QA-01..44) in [REPORT.md](./REPORT.md), the 11-theme UX suggestions and the per-app UI improvements agreed on 30 Oct 2026.
Branch: `feat/uiux-overhaul` (from `master`). Nothing is merged to `master` until each phase passes the gate below.

## Working rules
- One commit per work item, message `uiux(QA-nn): ...` or `uiux(ui-xx): ...`; each phase is a PR-sized group of commits that can be reviewed and reverted alone.
- Test first for logic (validation, search loading, retry/back-off, owner default, fallback titles). Visual-only changes get a before/after screenshot in `docs/qa/uiux-2026-10-30/after/`.
- Gate for every phase: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` green, then the same screens re-captured in the desktop app (light, dark, Deloitte, 1024x720 and 1426x850) and compared with the original screenshots.
- Reuse existing primitives in `src/components/ui/` (Dialog, ToastHost, Tooltip, Tabs, Badge, Input, Popover...) and tokens in `src/styles/tokens.css`; add new shared components there, not per app.
- No new dependencies unless a phase needs one (chart/tree rendering is first tried with SVG/CSS).
- Update `README.md` and the relevant docs when behaviour changes.

## Phase 0 - Setup (0.5 day)
1. Create `feat/uiux-overhaul`; commit the QA report and screenshots as the baseline.
2. Keep the QA harness (`docs/qa/harness`) as the visual-regression tool; add a script that re-captures the 60 key screens into `after/`.
3. Add a `docs/ui-guidelines.md` with the decisions in Phase 1 (type scale, spacing, elevation, button order, empty/error/loading patterns, date format, terms).

## Phase 1 - Design foundation and shared components (3-4 days)
Everything later depends on this.

| Item | Covers |
| --- | --- |
| Opaque dialog surface, consistent radius/elevation/backdrop in `Dialog.tsx` | QA-05, UX-5 |
| Tooltips/popovers close when a modal opens | QA-15 |
| `Toast` position, type icons, auto-dismiss, optional Undo action in `ToastHost.tsx` | QA-22, QA-43, UX-2 |
| `EmptyState`, `ErrorState` (cause + next step + copy details), `Skeleton` components | QA-17, 34, 35, 32, UX-3 |
| `ChipInput` (emails, domains, skills, To/Cc) with per-chip validation | QA-02, QA-16 |
| `FormField` with outline + inline error shown after blur/first submit; `spellCheck=false` helper for search/email/id inputs | QA-18, 26, UX-4 |
| `ValidationSummary` (the Staff "Add employees" pattern, extracted) | QA-02, UX-4 |
| Type scale, 8-px spacing and contrast fixes in `tokens.css` (pale buttons, captions, Deloitte accent) | UX-5, UX-9 |
| Footer action order + destructive button variant in `Button.tsx` | QA-31, QA-37 |
| Icon-only buttons require aria-label + tooltip (lint rule or `IconButton` prop) | QA-25, UX-9 |
| Shared `StatusChip`, `DueChip`, `PriorityStripe`, `SourceBadge` | PMO, Staff, Toolkit |
| Window title bar: icon, app name, context suffix; larger controls; no text selection while dragging | UX-6, QA-40 |
| Shared date and term helpers (`30 Oct 2026`, Total/Pending, To-do) | UX-5, QA-24 |

## Phase 2 - High-severity fixes (2 days)
- **QA-01** Tasks launcher: retry with back-off for ~10 s, real cause in the message; warm the engine after startup (`useEngineLauncher.ts`, desktop warm-up).
- **QA-02** PMO setup/settings: validate emails and domains (shared schema in `src/lib/pmo`), per-line errors, replace instead of append, show allowed list and flag malformed entries in the Filtered card; server-side validation in `/api/pmo/setup` and `/api/pmo/config`.
- **QA-03** Ctrl+K: loading state and re-run query when data arrives (`GlobalSearch.tsx`); prefetch on start.

## Phase 3 - Medium fixes (5-6 days)
Staff: QA-06 (email wrapping), 07 (columns, detail pane), 08 (roster legend and toolbar), 09 (Capacity help text, buttons), 10 (Org chart as a tree).
PMO To-Do: QA-04 (calendar scroll to today), 11 (fallback title and "not structured" state), 12 (owner from setup name), 13 (chip row wrap), 14 (toolbar consolidation).
Other: QA-16 (Templates To/Cc), 17-18 (RAID empty state and form), 19 (Files demo labelling or real folder), 20 (AI progress, elapsed time, Stop).
Each item ships with tests where there is logic (title fallback, owner default, calendar anchor date, chip validation).

## Phase 4 - Low fixes (3-4 days)
QA-21..44, grouped by app so each app's pass is one commit series: Staff (21-26), Dashboard (27), PMO (28-32), Tasks (33-36), Templates (37), Toolkit/RAID (38-39), Files/Notes/Browser/App Store (40-43), Settings (44).

## Phase 5 - UI improvements, shell first (4-5 days)
1. **Dock and command bar:** hover labels, badge meaning, keyboard hint, wider answer bubble with actions.
2. **Ctrl+K:** grouped results, recents, keyboard hint.
3. **Lock screen and desktop:** user name/avatar, optional "needs you" summary.
4. **Dashboard:** content-sized cards, drag-to-reorder in Customise, compact empty states, charts (workload bars, report health chips, week-over-week sparklines), "Updated n min ago".
5. **Settings:** search, card grouping, storage meter, timeline-style Activity with readable names.
6. **Responsive pass at 1024x720:** stacked/drawer detail panes, overflow "More" menus.

## Phase 6 - UI improvements, per app (10-12 days)
Each app is a separate commit series and can be shipped independently, in this order (biggest daily use first):
1. **PMO To-Do:** two-pane review queue, original message beside the draft with highlighted quote, priority-striped cards with due chips and avatars, board column counts, calendar with today highlight and "n more", reports preview, wizard stepper and summary, Settings tabs with Teams under Advanced.
2. **Staff:** directory table with chips, slide-in detail with grouped fields and skill chips, roster with colour-coded cells and leave overlay, Time off cards with overlap strip, Insights left sub-nav (capacity heatmap, distributions, balance bars, skills matrix, org tree, holidays calendar), two-column dialogs.
3. **Tasks:** workflow cards with last-run status, drop zones with accepted-file state, vertical step timeline in Details, history table with pills, weekly schedule strip, pack card grid.
4. **Templates:** type icons and "used by" badge, split editor/preview with placeholder palette, versions drawer with diff.
5. **PMO Toolkit and RAID:** grouped launcher, RAG table with heat-map summary, card view, two-column Add form; apply the same toolbar/table/form to the other tools.
6. **Files, Notes, Browser, App Store:** breadcrumbs and grid/list, pinned notes with tags and formatting toolbar, tabs and new-tab page, store hero, detail sheet and install progress.

## Phase 7 - Verification and release (2-3 days)
- Re-run the full QA pass on the same dummy data; every QA-nn marked Fixed/Won't fix in REPORT.md with an "after" screenshot.
- Check accessibility: keyboard-only walkthrough, focus trap/return in all dialogs, contrast of both themes, reduced motion.
- Performance: window open/close frame times, search latency, idle CPU (same measures used in `QA-DESKTOP-2026-10-29.md`).
- Production build (`pnpm build`, `live-build`) smoke test and installer build check.
- Update README, CHANGELOG-style notes in docs, then open one PR per phase (or one squash PR) against `master`.

## Estimate and order of delivery
About 30-36 working days for Phases 0-7 for one developer. Suggested delivery order if time is limited: Phase 1 -> 2 -> 3 -> 4 (all fixes, about 3 weeks), then Phase 5 and 6 per app by usage, then Phase 7. **Phase 8 (real-model AI evaluation and tuning) is always last**: 2-3 days of mostly unattended runs plus 1-2 days of prompt/validation fixes. If an online model is approved (see "Online AI option" below), it is added to this phase as a third candidate.

## Decisions (30 Oct 2026)
- **Files app (QA-19):** keep it a demo and label it clearly (a "Sample files - demo" banner and first-use note). No real-folder work now; Files drops out of the Phase 6 grid/breadcrumb work except the label and the text-selection fix (QA-40).
- **Large layout changes:** ship directly, no feature flag.
- **AI items (QA-11, QA-20 and the PMO structuring quality):** verified with the real local models in the final phase (Phase 8), **`gemma4:12b` and `qwen3.5:4b` only**. The other Qwen models (`qwen3.5:2b`, `qwen3.5:9b`, `qwen2.5:7b-instruct-q4_K_M`) were deleted from this PC to save storage; `llama3.2` is untouched and not part of the evaluation. See "AI accuracy track" below.
- **Architecture:** the app is 64-bit only (x64): Electron, the bundled Python 3.13 runtime and the NSIS installer are all x64 (win_amd64). No change planned.

## AI accuracy track - FINAL PHASE (Phase 8, runs after everything else is done)
Moved to the very end on 1 Nov 2026 because the real-model runs take hours on this CPU. Until then, AI-related UI work (QA-11 fallback title and "not structured" state, QA-20 progress/Stop, QA-30 loading states) is built and tested against the stub and unit tests only; Phase 8 is where it is checked against real models and the prompts are tuned.

**Entry condition:** Phases 0-7 are finished and merged on `feat/uiux-overhaul`, so the model tuning is done on the final UI and code, and is run once, unattended.
1. Build a small fixed test set from the 7 dummy mails plus the examples in `pmo-intake/examples` (action request, FYI, urgent, French with emoji, waiting-on, blocked domain, long sender, multi-task mail), each with a hand-written expected result (title, owner, requester, due date, priority, waiting-on, action items, "not a task").
2. Run each message through the real structuring path (no `PMO_AI_STUB`) once per model, two models only: `gemma4:12b` (current default) and `qwen3.5:4b` (the app's "light/fast" model). Same prompts, temperature and timeouts, `think: false`. Record the output, latency and tokens/s per model (CPU-only here) in `docs/qa/uiux-2026-10-30/ai-eval/`.
3. Score each field against the expected value (exact match for dates/emails, fuzzy for titles) and list the failure patterns (wrong owner, invented dates, greeting used as title, missed action items, hallucinated names, malformed JSON).
4. Fix by priority: prompt and schema tightening (`structurePrompt.ts`, `updatePrompt.ts`), pre-processing (`preprocess.ts`, `quote.ts`: strip greetings/signatures), post-validation and fallbacks (`sanitizeDraft.ts`: subject fallback, date and owner checks, verified quote), then model choice per task (fast model vs careful model, existing "Fast AI model" setting).
5. Re-run the same set after each fix; accept when the chosen default model meets the target (proposal: >= 90 % on title, owner, requester, due date; 0 invented dates/names) and a message never gets stuck longer than the UI timeout. The outcome decides the default: keep `gemma4:12b` (careful, slow) with `qwen3.5:4b` as the fast option, or promote `qwen3.5:4b` if it meets the target.
6. **Code cleanup that follows from dropping the other Qwen models:** `FALLBACK_MODEL = "qwen3.5:9b"` in `src/lib/setup/models.ts` (and its size table entry, plus the comment in `src/lib/ai-runtime/core.ts`) points at a model that is no longer installed. Change the fallback to `qwen3.5:4b` so the Setup and health check does not offer to download 6.6 GB again; update the related tests.
7. Also check the command-bar paths with the real models (free-form request, the "Thinking..." progress and Stop from QA-20, model sleep/load times).

## Online AI option (open question, not scheduled)
Asked 1 Nov 2026: can the app use an online model such as Claude with an enterprise subscription and no API key?
- **Today the app is local-only by design:** `src/lib/ai-runtime/core.ts` talks only to Ollama (default `http://127.0.0.1:11434`, overridable with `OLLAMA_BASE_URL`), and the README states the AI is a local model with no cloud model. PMO inbox mail and staff data are client-confidential, so sending them to an online service is a policy decision first and a coding task second.
- **A Claude Enterprise / claude.ai seat normally does not include API access.** It covers the Claude apps and Claude Code; the Anthropic API is a separate product billed against an API key (Console) or through a cloud provider. Without a key, the app cannot call Claude directly.
- **Routes that do not need a personal API key:**
  1. **Company-provided gateway:** Azure OpenAI / Microsoft Foundry, Amazon Bedrock (Claude) or Google Vertex, if the firm already provides one. Needs an endpoint and an identity (Entra / IAM), not necessarily a raw key. Ask IT/AI governance.
  2. **GitHub Copilot SDK:** signs in with the user's GitHub Copilot entitlement and can use the models the organisation enables (these may include Claude models). Verify with your Copilot admin which models and data-handling terms apply.
  3. **Keep local** (current design): nothing leaves the PC.
- **If approved, the change is small:** add an optional "AI provider" in Settings (Local Ollama default, Online off), a provider interface behind `ai-runtime`, a visible "online model - data leaves this PC" indicator, per-feature opt-in (for example, never for raw PMO mail unless allowed), redaction of names/emails before sending, and the same test set in Phase 8 to compare it with `gemma4:12b` and `qwen3.5:4b`.
- **Needed from you before any work:** whether the firm allows client mail content to go to an approved online model, and which route (1 or 2) is permitted.

## Risks
- **Charts and tree views** (Dashboard, Insights): SVG/CSS first; add a library only if needed.
- **Model speed:** `gemma4:12b` runs on the CPU here (about 4 tokens/s, 150-180 s per message in the earlier QA); `qwen3.5:4b` should be faster. Because this is Phase 8, it never blocks the UI work; run it unattended, one model at a time.
- **Online AI:** not part of the plan unless approved; see "Online AI option".
- **Large layout changes** (two-pane review queue, Insights sub-nav) change habits; the new layout will be documented in the README.
- **Pre-existing change:** `build/installer/sidebar.bmp` shows as modified on `master` and is unrelated; it will be left out of every commit.

## Progress (1 Nov 2026)
- Phase 0, 1, 2, 3 and 4 are DONE and merged on `feat/uiux-overhaul` (all of QA-01..44 except QA-19 which was reduced to a demo label as decided). Checks on the merged tree: tsc clean, 2665 tests pass, ESLint clean on `src` and `desktop`, Prettier clean on changed files. Verified in the running desktop app; after-screenshots in `docs/qa/uiux-2026-10-30/after/wave1` and `wave2`.
- Phase 5 (shell UI) and Phase 6 (per-app UI) are next, then Phase 7 (verification) and Phase 8 (real-model AI evaluation, last).
- How to run ESLint here: set `NODE_PATH` to the `node_modules` folder of the `eslint-config-next@*` entry under `node_modules/.pnpm` and run `node node_modules/eslint/bin/eslint.js src desktop`.

- **Phase 5 and 6 merged (1 Nov 2026):** shell (dock, command bar, Ctrl+K, lock screen, Dashboard charts, Settings), PMO To-Do (two-pane review queue, cards, board, calendar, reports, wizard, settings tabs), Staff (directory, roster overlay, time-off cards, Insights), Tasks and Templates, PMO Toolkit/RAID, Notes, Browser, App Store. Merged tree: tsc clean, 2906 tests pass, ESLint clean, Prettier clean. After-screenshots in `after/wave3`.
- Remaining: Phase 7 (verification: full re-check of every QA item, dark/Deloitte themes, 1024x720, accessibility, performance, production build) and Phase 8 (real-model AI evaluation).
