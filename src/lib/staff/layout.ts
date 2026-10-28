// Sizes of the resizable parts of the Directory: the list's columns and the
// right-hand detail pane. Pure, so the clamping and the stored-value checks are
// testable; the component keeps the values in localStorage.

export const DIRECTORY_COLUMNS = [
  { key: "employee", label: "Employee", width: 270, min: 170 },
  { key: "level", label: "Level", width: 150, min: 70 },
  { key: "op", label: "OP", width: 150, min: 70 },
  { key: "offering", label: "Offering", width: 140, min: 70 },
  { key: "team", label: "Team", width: 130, min: 70 },
  { key: "location", label: "Location", width: 110, min: 80 },
  { key: "rolloff", label: "Roll-off", width: 120, min: 80 },
] as const;

export type DirectoryColumnKey = (typeof DIRECTORY_COLUMNS)[number]["key"];
export type ColumnWidths = Record<DirectoryColumnKey, number>;

export const MAX_COLUMN_WIDTH = 640;

export const PANE_WIDTH = { default: 340, min: 280, max: 640 } as const;
/** The list always keeps at least this much room when the pane is widened. */
export const MIN_LIST_WIDTH = 320;

export const COLUMN_WIDTHS_KEY = "ai-os:staff:column-widths";
export const PANE_WIDTH_KEY = "ai-os:staff:pane-width";

export const defaultColumnWidths = (): ColumnWidths =>
  Object.fromEntries(DIRECTORY_COLUMNS.map((c) => [c.key, c.width])) as ColumnWidths;

export function clampColumnWidth(key: DirectoryColumnKey, width: number): number {
  const column = DIRECTORY_COLUMNS.find((c) => c.key === key)!;
  if (!Number.isFinite(width)) return column.width;
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(column.min, width)));
}

/** `available` is the width the pane may grow into (the whole panel); when it is
 *  unknown the fixed maximum applies. */
export function clampPaneWidth(width: number, available?: number): number {
  if (!Number.isFinite(width)) return PANE_WIDTH.default;
  const room = available === undefined ? PANE_WIDTH.max : available - MIN_LIST_WIDTH;
  const max = Math.max(PANE_WIDTH.min, Math.min(PANE_WIDTH.max, room));
  return Math.round(Math.min(max, Math.max(PANE_WIDTH.min, width)));
}

/** Widths from stored text; anything missing or not a number falls back to the default. */
export function parseColumnWidths(text: string | null): ColumnWidths {
  const widths = defaultColumnWidths();
  if (!text) return widths;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return widths;
    for (const column of DIRECTORY_COLUMNS) {
      const value = raw[column.key];
      if (typeof value === "number")
        widths[column.key] = clampColumnWidth(column.key, value);
    }
  } catch {
    // A damaged value just means the defaults.
  }
  return widths;
}

export function parsePaneWidth(text: string | null): number {
  const value = text === null ? NaN : Number(text);
  return Number.isFinite(value) ? clampPaneWidth(value) : PANE_WIDTH.default;
}

export const totalWidth = (widths: ColumnWidths): number =>
  DIRECTORY_COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);
