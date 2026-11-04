// The model name shown next to the command bar's status pill. Pure.

const MAX_NAME = 32;

/** The model to show from GET /api/ai/model's reply ({ ok: true, active }), or null when
 *  the reply is not usable (the pill then shows no name rather than a wrong one). */
export function activeModelName(reply: unknown): string | null {
  if (typeof reply !== "object" || reply === null) return null;
  const { ok, active } = reply as { ok?: unknown; active?: unknown };
  if (ok !== true || typeof active !== "string") return null;
  const name = active.trim();
  if (!name) return null;
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}
