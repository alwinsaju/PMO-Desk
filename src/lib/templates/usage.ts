// When each template last produced a draft, kept on this computer so the Templates app can say so. Pure.

export type Usage = Record<string, string>;

const MAX = 200;

export function sanitizeUsage(value: unknown): Usage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Usage = {};
  for (const [id, at] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX) break;
    if (
      /^tpl_[0-9a-f]{8,32}$/.test(id) &&
      typeof at === "string" &&
      !Number.isNaN(Date.parse(at))
    )
      out[id] = at;
  }
  return out;
}

export function markUsed(usage: Usage, id: string, at: string): Usage {
  return usage[id] === at ? usage : { ...usage, [id]: at };
}

/** "Last made a draft 3 days ago", or "No draft yet". */
export function lastUsedText(at: string | undefined, now: Date): string {
  if (!at) return "No draft yet";
  const ms = now.getTime() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 0) return "Made a draft just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Made a draft just now";
  if (minutes < 60) return `Last made a draft ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last made a draft ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Last made a draft ${days} day${days === 1 ? "" : "s"} ago`;
}
