// Pure interpretation of whatever is typed into the Browser app's address bar.

export const SEARCH_BASE_URL = "https://duckduckgo.com/";
export const BLOCKED_ADDRESS_MESSAGE = "That address type is not allowed.";
const MAX_QUERY_CHARS = 1000;

export type BrowserInput =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string }
  | { kind: "blocked"; reason: string };

const BLOCKED_SCHEMES =
  /^(?:javascript|data|file|vbscript|blob|about|chrome|edge|view-source|ftp|mailto|tel|ws|wss):/i;
const HTTP_URL = /^https?:\/\//i;
const ANY_AUTHORITY_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST =
  /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;

function parseHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    return isHttp && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function searchUrlFor(query: string): string {
  return `${SEARCH_BASE_URL}?q=${encodeURIComponent(query)}`;
}

/** An address -> `url`; plain words -> a web `search`; script/data/file-style
 *  schemes -> `blocked`. */
export function resolveBrowserInput(text: string): BrowserInput {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };

  if (HTTP_URL.test(trimmed)) {
    const url = parseHttpUrl(trimmed);
    if (url) return { kind: "url", url };
  } else if (BLOCKED_SCHEMES.test(trimmed) || ANY_AUTHORITY_URL.test(trimmed)) {
    return { kind: "blocked", reason: BLOCKED_ADDRESS_MESSAGE };
  } else if (BARE_HOST.test(trimmed)) {
    const url = parseHttpUrl(`https://${trimmed}`);
    if (url) return { kind: "url", url };
  }

  const query = trimmed.replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS);
  return { kind: "search", url: searchUrlFor(query), query };
}
