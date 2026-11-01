// The "Still needed" line of the Run dialog (see stillNeeded.test.mjs). Pure.

/** A file's name without its "(Names.xlsx: Full Name, Email)" detail, which the card already shows. */
export const shortLabel = (label: string): string =>
  label.replace(/\s*\([^)]*\)\s*/g, " ").trim() || label;

/** "Still needed: ServiceNow incident export, Team roster", or "" when nothing is. */
export function stillNeededText(missing: readonly string[]): string {
  if (missing.length === 0) return "";
  return `Still needed: ${missing.map(shortLabel).join(", ")}`;
}
