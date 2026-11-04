// Best-effort copy of the appearance choice (theme, brand) on the server, so a
// new origin (another port) can pick it up. localStorage stays the source the
// page reads before hydration; nothing here may ever block or throw. It has its
// own ui-state key: "preferences" belongs to the preferences store, whose
// persisted shape ({ state, version }) a { theme, brand } write would replace.
const URL_PATH = "/api/ui-state/appearance";

export type PreferencesFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Undefined outside a real page (SSR, and the fake windows in unit tests). */
function pageFetch(): PreferencesFetch | undefined {
  if (typeof window === "undefined" || !window.location) return undefined;
  return (input, init) => globalThis.fetch(input, init);
}

/** Fire and forget. */
export function mirrorPreferences(
  value: Record<string, unknown>,
  fetchFn: PreferencesFetch | undefined = pageFetch(),
): void {
  if (!fetchFn) return;
  try {
    void fetchFn(URL_PATH, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(() => undefined);
  } catch {
    // Ignored on purpose.
  }
}

/** The saved preferences object, or null when absent or the server can't be reached. */
export async function fetchServerPreferences(
  fetchFn: PreferencesFetch | undefined = pageFetch(),
): Promise<Record<string, unknown> | null> {
  if (!fetchFn) return null;
  try {
    const response = await fetchFn(URL_PATH);
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; value?: unknown };
    const value = body?.value;
    return body?.ok === true &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
