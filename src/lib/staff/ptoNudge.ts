// The words of the AI widget's PTO heads-up. Pure: `formatRange` is passed in, so
// `pnpm test` covers the wording and the "what is new since I last looked" rule.
import type { PtoAlert } from "./ptoAlert.ts";
import { TIME_OFF_META } from "./timeoff.ts";

export type PtoAlertView = PtoAlert;

/** Ids of pending requests the person has not been told about yet. */
export function unseenIds(alert: PtoAlert, seen: readonly string[]): string[] {
  const known = new Set(seen);
  return alert.pending.map((p) => p.id).filter((id) => !known.has(id));
}

export type PtoNudgeCopy =
  | { kind: "approve"; title: string; lines: string[] }
  | { kind: "reading"; title: string; lines: string[] };

const MAX_LINES = 3;

/** A "dismiss the reading card" choice lasts only for the current reading run: once the
 *  reader goes idle the flag clears, so the next run shows the card again. */
export function keepReadingDismissed(dismissed: boolean, alert: PtoAlert): boolean {
  return dismissed && alert.reading;
}

/** What the AI says, or null when there is nothing to say. New requests win over "reading".
 *  `readingDismissed` hides only the "reading" card; new requests always show. */
export function describePtoAlert(
  alert: PtoAlert,
  unseen: readonly string[],
  formatRange: (start: string, end: string) => string,
  readingDismissed = false,
): PtoNudgeCopy | null {
  if (unseen.length > 0) {
    const fresh = new Set(unseen);
    const items = alert.pending.filter((p) => fresh.has(p.id));
    const lines = items
      .slice(0, MAX_LINES)
      .map(
        (p) =>
          `${p.name}: ${TIME_OFF_META[p.type].label}, ${formatRange(p.startDate, p.endDate)}`,
      );
    if (items.length > MAX_LINES) lines.push(`and ${items.length - MAX_LINES} more`);
    return {
      kind: "approve",
      title:
        items.length === 1
          ? "I read a leave email. It needs your approval."
          : `I read ${items.length} leave emails. They need your approval.`,
      lines,
    };
  }
  if (alert.reading && !readingDismissed) {
    return {
      kind: "reading",
      title: "Reading a leave email...",
      lines: alert.waiting > 1 ? [`${alert.waiting - 1} more waiting`] : [],
    };
  }
  return null;
}
