// Remembering which action lines of a meeting already became to-dos, so finding them again never makes the
// same to-do twice. Pure; the page keeps the list in the browser's local storage.

export interface MadeLine {
  title: string;
  owner: string | null;
  dueAt: string | null;
}

const MAX_KEPT = 300;

/** One line's identity: its words (any case, spacing), who it is for and when it is due. */
export function lineKey(line: MadeLine): string {
  return [
    line.title.toLowerCase().replace(/\s+/g, " ").trim(),
    (line.owner ?? "").toLowerCase().trim(),
    line.dueAt ?? "",
  ].join("|");
}

/** The stored list; anything that is not a list of text is ignored. */
export function parseMade(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string").slice(-MAX_KEPT)
      : [];
  } catch {
    return [];
  }
}

/** The list with these lines added (each once; the newest MAX_KEPT are kept). */
export function withMade(kept: readonly string[], lines: readonly MadeLine[]): string[] {
  return [...new Set([...kept, ...lines.map(lineKey)])].slice(-MAX_KEPT);
}
