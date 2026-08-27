/**
 * Tunable numbers/strings for the mocked agent demo sequence (see
 * CommandBar.tsx's submit handler). Centralized here — the same way
 * `windowDefaults` centralizes the window manager's tunables in
 * `src/lib/tokens.ts` — so the pacing of the whole "AI does something"
 * beat can be adjusted from one place.
 */

/** How long a task stays "working" before flipping to "completed". */
export const TASK_WORKING_MS = 2600;

/** How long a task stays "completed" (badge + presence ring) before the
 *  sequence resets to idle and the next submit is allowed. */
export const TASK_SETTLE_MS = 2200;

/** How long the "open an app first" empty-state notice stays visible. */
export const EMPTY_STATE_NOTICE_MS = 2800;

/**
 * Short canned messages AIAnnotationBubble shows while a task is
 * "working" — picked at random per task purely for demo variety. This is
 * a mocked shell: the message is never derived from the user's actual
 * prompt text, and no specific app is inspected to produce it.
 */
export const CANNED_ANNOTATIONS = [
  "Taking a look…",
  "Looking into this window…",
  "Give me a moment…",
  "On it — one moment…",
] as const;

export function pickCannedAnnotation(): string {
  return CANNED_ANNOTATIONS[Math.floor(Math.random() * CANNED_ANNOTATIONS.length)];
}
