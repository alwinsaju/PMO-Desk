// Pure interpretation of whatever is typed into the Browser app's address bar.

export const SEARCH_BASE_URL = "https://duckduckgo.com/";
export const BLOCKED_ADDRESS_MESSAGE = "That address type is not allowed.";
export const LOCAL_PATH_MESSAGE =
  "That looks like a file or folder on this computer or network, not a web address. It was not searched for, and PMO Desk can't open it here.";
export const INVALID_ADDRESS_MESSAGE =
  "That does not look like a valid web address. Check it for typing mistakes.";
const MAX_QUERY_CHARS = 1000;

export type BrowserInput =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string }
  | { kind: "blocked"; reason: string };

const BLOCKED_SCHEMES =
  /^(?:javascript|data|file|vbscript|blob|about|chrome|edge|view-source|ftp|mailto|tel|ws|wss):/i;
const HTTP_URL = /^https?:\/\//i;
// C:\path, C:/path, \\server\share, //server/share: kept off the search engine.
const LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\|\/\/)/i;
// "http:/host" or "https:host": meant as an address, typed wrongly.
const BROKEN_SCHEME = /^https?:(?!\/\/)\S/i;
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

  if (LOCAL_PATH.test(trimmed)) return { kind: "blocked", reason: LOCAL_PATH_MESSAGE };
  if (BROKEN_SCHEME.test(trimmed)) {
    return { kind: "blocked", reason: INVALID_ADDRESS_MESSAGE };
  }

  if (HTTP_URL.test(trimmed)) {
    const url = parseHttpUrl(trimmed);
    if (url) return { kind: "url", url };
  } else if (BLOCKED_SCHEMES.test(trimmed) || ANY_AUTHORITY_URL.test(trimmed)) {
    return { kind: "blocked", reason: BLOCKED_ADDRESS_MESSAGE };
  } else if (BARE_HOST.test(trimmed)) {
    const url = parseHttpUrl(`https://${trimmed}`);
    if (url) return { kind: "url", url };
    // Shaped like a host but not one (e.g. port 99999): a typo, not a search.
    return { kind: "blocked", reason: INVALID_ADDRESS_MESSAGE };
  }

  const query = trimmed.replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS);
  return { kind: "search", url: searchUrlFor(query), query };
}
