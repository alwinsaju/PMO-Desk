/**
 * Tunable numbers for the real agent sequence (see CommandBar.tsx's submit
 * flow). Centralized here — the same way `windowDefaults` centralizes the
 * window manager's tunables in `src/lib/tokens.ts` — so the pacing of the
 * whole "AI does something" beat can be adjusted from one place.
 *
 * There is deliberately no fixed "how long the AI thinks" timer any more:
 * that phase's real duration is however long the actual `/api/ai/command`
 * request takes (a couple of seconds to considerably longer, depending on
 * the local model/hardware — see that route's own doc comment), not a
 * simulated wait. Everything below is purely about how long the RESULT
 * stays visible once the request comes back, not about faking work that
 * isn't happening.
 */

/** How long the "open an app first" empty-state notice (and any AI-command
 *  error notice — see CommandBar.tsx's `showNotice`) stays visible. */
export const EMPTY_STATE_NOTICE_MS = 2800;

/** How long an applied note action's cursor/glow/annotation stay on screen
 *  — after the action has already been applied to `notesStore` — before
 *  control reverts to the human. Just long enough to see the cursor land
 *  on the window and read the annotation; nothing is "in progress" during
 *  this window, the mutation already happened the moment it started. */
export const ACTION_HOLD_MS = 1300;

/** How long a completed task's status (badge + presence ring) stays
 *  visible before the sequence resets to idle and the next submit is
 *  allowed. */
export const TASK_SETTLE_MS = 1200;
