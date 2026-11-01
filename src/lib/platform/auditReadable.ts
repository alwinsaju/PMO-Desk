// Plain-words view of an audit record for Settings > Activity. The raw
// "key: value" details (ids included) stay on the entry for the tooltip and CSV.

const ID_VALUE = /^[a-z]{1,4}_[0-9a-f]{6,}$/i;
const ID_KEYS = new Set(["id", "ids", "todoId", "proposalId"]);
const MAX_LIST = 3;

const isId = (value: unknown): boolean =>
  typeof value === "string" && ID_VALUE.test(value);

/** "reportWeek" -> "Report week". */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function listText(items: unknown[]): string {
  const shown = items.slice(0, MAX_LIST).map(String).join(", ");
  return items.length > MAX_LIST ? `${shown} +${items.length - MAX_LIST}` : shown;
}

function valueText(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return isId(value) ? null : value;
  if (Array.isArray(value)) {
    const items = value.filter((v) => !isId(v));
    return items.length === 0 ? null : listText(items);
  }
  return null;
}

/** Facts worth reading, without internal ids; empty when only ids were recorded. */
export function readableDetails(record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (ID_KEYS.has(key) || value === null || value === undefined || value === "") {
      continue;
    }
    const text = valueText(value);
    if (text) lines.push(`${humanize(key)}: ${text}`);
  }
  return lines;
}

/** Every line is written by the signed-in OS user, so show it as "You". */
export const actorLabel = (user: string): string => (user ? "You" : "");
