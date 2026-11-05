/** Safety checks on a draft's recipients before it is confirmed or queued. Pure. */

export interface Recipients {
  to: string[];
  cc: string[];
}

export interface RecipientWarning {
  kind: "changed" | "external" | "invalid";
  text: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** An entry must be one address ("a@b.com" or "Name <a@b.com>"), not text with something else hidden in it. */
export const looksLikeAddress = (entry: string): boolean =>
  /^(?:[^<>@;]*<)?[^\s<>@;,]+@[^\s<>@;,]+\.[A-Za-z]{2,}>?$/.test(entry.trim());

const domainOf = (address: string): string => {
  const m = /@([^>\s;]+)>?$/.exec(address.trim());
  return m ? m[1].toLowerCase() : "";
};

const diff = (before: readonly string[], after: readonly string[]) => {
  const b = new Set(before.map(norm));
  const a = new Set(after.map(norm));
  return {
    added: after.filter((x) => !b.has(norm(x))),
    removed: before.filter((x) => !a.has(norm(x))),
  };
};

/** The email domains that count as "ours": every domain seen in `staffAddresses`, plus any given explicitly. */
export function internalDomains(
  staffAddresses: readonly string[],
  extra: readonly string[] = [],
): Set<string> {
  const out = new Set(extra.map((d) => d.toLowerCase()));
  for (const a of staffAddresses) {
    const d = domainOf(a);
    if (d) out.add(d);
  }
  return out;
}

export function checkRecipients(
  current: Recipients,
  previous: Recipients | null,
  internal: ReadonlySet<string>,
): RecipientWarning[] {
  const warnings: RecipientWarning[] = [];
  const invalid = [...current.to, ...current.cc].filter((a) => a.trim() && !looksLikeAddress(a));
  if (invalid.length) {
    warnings.push({
      kind: "invalid",
      text: `Not a clear email address: ${[...new Set(invalid)].join(", ")}. Check the recipients in Outlook.`,
    });
  }
  if (previous) {
    for (const [label, before, after] of [
      ["To", previous.to, current.to],
      ["Cc", previous.cc, current.cc],
    ] as const) {
      const { added, removed } = diff(before, after);
      if (added.length || removed.length) {
        const parts = [
          added.length ? `added ${added.join(", ")}` : "",
          removed.length ? `removed ${removed.join(", ")}` : "",
        ].filter(Boolean);
        warnings.push({
          kind: "changed",
          text: `${label} changed since last time: ${parts.join("; ")}.`,
        });
      }
    }
  }
  if (internal.size > 0) {
    const external = [...current.to, ...current.cc].filter((a) => {
      const d = domainOf(a);
      return d !== "" && !internal.has(d);
    });
    if (external.length) {
      warnings.push({
        kind: "external",
        text: `Outside your organisation: ${[...new Set(external)].join(", ")}.`,
      });
    }
  }
  return warnings;
}

export const sameRecipients = (a: Recipients, b: Recipients): boolean =>
  diff(a.to, b.to).added.length === 0 &&
  diff(a.to, b.to).removed.length === 0 &&
  diff(a.cc, b.cc).added.length === 0 &&
  diff(a.cc, b.cc).removed.length === 0;

export const ATTACHMENT_WARN_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_STOP_BYTES = 20 * 1024 * 1024;

/** Warns when attachments are likely to be refused or slow. Sizes are optional (the engine only names them). */
export function attachmentWarning(
  attachments: readonly { name: string; bytes?: number }[],
): string | null {
  if (attachments.length === 0) return null;
  const total = attachments.reduce((s, a) => s + (a.bytes ?? 0), 0);
  if (total >= ATTACHMENT_STOP_BYTES)
    return `The attachments are ${(total / 1048576).toFixed(0)} MB. Many mail systems refuse over 20 MB; remove one in Outlook first.`;
  if (total >= ATTACHMENT_WARN_BYTES)
    return `The attachments are ${(total / 1048576).toFixed(0)} MB, which is large. Check they are all needed.`;
  return null;
}
