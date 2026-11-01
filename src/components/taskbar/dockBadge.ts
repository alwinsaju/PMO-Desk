// Pure helpers for the count badge on a dock tile (see dockBadgeStore.ts).

/** What the badge shows: nothing for 0 (or a bad value), the number up to 9,
 *  then "9+" so it never outgrows the tile corner. */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  const whole = Math.floor(count);
  return whole > 9 ? "9+" : String(whole);
}

/** Spoken label for a tile that carries a badge. */
export function badgedLabel(
  label: string,
  count: number,
  noun = "need attention",
): string {
  return badgeText(count) === null ? label : `${label}, ${Math.floor(count)} ${noun}`;
}

/** The parts of a "needs you" total, one per source. */
export interface AttentionParts {
  pmo: number;
  leave: number;
  tasks: number;
  registers: number;
}

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** What a badge number is made of, for the tile's hover text:
 *  "3 need attention: 2 PMO items, 1 time-off request". Null with nothing to say. */
export function attentionMeaning(parts: AttentionParts): string | null {
  const pieces: [number, string, string][] = [
    [whole(parts.pmo), "PMO item", "PMO items"],
    [whole(parts.leave), "time-off request", "time-off requests"],
    [whole(parts.tasks), "task needing you", "tasks needing you"],
    [whole(parts.registers), "late toolkit item", "late toolkit items"],
  ];
  const shown = pieces.filter(([n]) => n > 0);
  const total = shown.reduce((sum, [n]) => sum + n, 0);
  if (total === 0) return null;
  const list = shown.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(", ");
  return `${total} ${total === 1 ? "needs" : "need"} attention: ${list}`;
}

/** The hover text for a dock tile: its name, whether it is running, and what its badge means. */
export function tileHover(input: {
  label: string;
  running: "none" | "open" | "minimized";
  badge?: number;
  meaning?: string | null;
  windowTitles?: readonly string[];
}): { title: string; lines: string[] } {
  const lines: string[] = [];
  const count = whole(input.badge ?? 0);
  if (count > 0) {
    lines.push(
      input.meaning?.trim() || `${count} ${count === 1 ? "needs" : "need"} attention`,
    );
  }
  if (input.running === "open") lines.push("Open");
  else if (input.running === "minimized") lines.push("Minimized");
  if (input.windowTitles && input.windowTitles.length > 1) {
    lines.push(input.windowTitles.join(" · "));
  }
  return { title: input.label, lines };
}
