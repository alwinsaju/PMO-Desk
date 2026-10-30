// Focus mode: for a set time the dock is hidden and non-urgent notices are held back (they
// still go to the notification history). Pure.

export const DEFAULT_FOCUS_MINUTES = 25;
export const MAX_FOCUS_MINUTES = 240;

/** A sensible length: whole minutes, 1 to 240, the default when it is not a number. */
export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_FOCUS_MINUTES;
  return Math.min(MAX_FOCUS_MINUTES, Math.max(1, Math.round(minutes)));
}

export const focusEnd = (now: number, minutes: number): number =>
  now + clampMinutes(minutes) * 60_000;

export const isFocusActive = (until: number | null, now: number): boolean =>
  until !== null && until > now;

export function remainingText(until: number | null, now: number): string {
  if (!isFocusActive(until, now)) return "";
  const minutes = Math.ceil((until! - now) / 60_000);
  return minutes <= 1 ? "less than a minute left" : `${minutes} min left`;
}

/** "focus for 30 minutes", "focus mode for 2 hours", "stop focus": the minutes (0 = stop), or null. */
export function parseFocusCommand(text: string): number | null {
  const t = text
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
  if (/^(?:stop|end|leave|exit|turn\s+off)\s+focus(?:\s+mode)?$/.test(t)) return 0;
  const m =
    /^(?:start\s+|enter\s+|turn\s+on\s+)?focus(?:\s+mode)?(?:\s+for\s+(\d{1,3})\s*(min(?:ute)?s?|m|hours?|h))?$/.exec(
      t,
    );
  if (!m) return null;
  if (!m[1]) return DEFAULT_FOCUS_MINUTES;
  const n = Number(m[1]);
  return clampMinutes(/^h/.test(m[2]) ? n * 60 : n);
}
