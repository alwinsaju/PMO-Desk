// Recently visited sites for the Browser's new-tab page: newest first, one per site, capped.
// Pure; the page keeps the list in local storage (see browserTabs.test.mjs).

export interface RecentSite {
  url: string;
  host: string;
  /** Epoch ms of the last visit. */
  at: number;
}

export const MAX_RECENTS = 8;
export const RECENTS_KEY = "browser-recents";

const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

function parseWebUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Notes a visit: the site moves to the front with its latest address. Non-web addresses are ignored. */
export function addRecent(
  list: readonly RecentSite[],
  url: string,
  at: number,
): RecentSite[] {
  const parsed = parseWebUrl(url);
  if (!parsed) return [...list];
  const host = siteOf(parsed.hostname);
  const rest = list.filter((site) => site.host !== host);
  return [{ url: parsed.toString(), host, at }, ...rest].slice(0, MAX_RECENTS);
}

/** The saved list, read defensively: bad JSON or bad entries give fewer (or no) sites, never an error. */
export function parseRecents(raw: string | null): RecentSite[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const list: RecentSite[] = [];
  for (const item of data as Partial<RecentSite>[]) {
    const url = parseWebUrl(item?.url);
    if (!url) continue;
    const at = typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0;
    const host = siteOf(url.hostname);
    if (!list.some((s) => s.host === host)) list.push({ url: url.toString(), host, at });
  }
  return list.slice(0, MAX_RECENTS);
}
