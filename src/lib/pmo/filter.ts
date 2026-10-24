// The Deloitte-only filter: decides, from metadata alone, whether an intake
// may become a proposal. Pure; first rejecting rule wins; every rejection
// carries a human-readable reason that the Filtered tab shows verbatim.
import type { Intake, PmoConfig } from "./types.ts";

export type FilterConfig = Pick<
  PmoConfig,
  | "allowedTenantIds"
  | "teamsChatAllowlist"
  | "allowedSenderDomains"
  | "blockedDomains"
  | "blockedTerms"
>;

export type FilterCode =
  | "blocked-domain"
  | "blocked-term"
  | "teams-not-allowlisted"
  | "tenant-not-allowed"
  | "sender-domain-not-allowed";

export type FilterResult =
  { pass: true } | { pass: false; code: FilterCode; reason: string };

/** The domain of "a@b.com" or "Name <a@b.com>", lower-cased; null if none. */
export function domainOf(address: string | undefined | null): string | null {
  if (!address) return null;
  const match = /@([^\s<>@"']+)\s*>?\s*$/.exec(address.trim());
  return match ? match[1].toLowerCase().replace(/[.;,]+$/, "") : null;
}

/** `domain` is `listed` or a subdomain of it ("us.deloitte.com" matches
 *  "deloitte.com"; "notdeloitte.com" does not). */
export function domainMatches(domain: string, listed: string): boolean {
  const d = domain.toLowerCase();
  const l = listed.trim().toLowerCase().replace(/^@/, "");
  return l !== "" && (d === l || d.endsWith(`.${l}`));
}

/** The Teams "For a selected message" trigger gives a deep link but no plain
 *  tenant or chat id, so when the producer did not fill context.tenantId /
 *  chatId they are read from the link:
 *  https://teams.microsoft.com/l/message/<chatId>/<messageId>?tenantId=<guid>... */
export function teamsIdsOf(intake: Pick<Intake, "context" | "link">): {
  tenantId?: string;
  chatId?: string;
} {
  let tenantId = intake.context.tenantId;
  let chatId = intake.context.chatId;
  if (intake.link && (!tenantId || !chatId)) {
    try {
      const url = new URL(intake.link);
      tenantId ??= url.searchParams.get("tenantId") ?? undefined;
      const segment = /^\/l\/message\/([^/]+)/.exec(url.pathname)?.[1];
      if (segment) chatId ??= decodeURIComponent(segment);
    } catch {
      // Not a URL (e.g. outlook:<EntryID>): nothing to derive.
    }
  }
  return { tenantId: tenantId || undefined, chatId: chatId || undefined };
}

const PASTED_ADDRESS = /[A-Z0-9._%+-]+@((?:[A-Z0-9-]+\.)+[A-Z]{2,})/gi;

function sameId(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function filterIntake(intake: Intake, config: FilterConfig): FilterResult {
  const people = [
    intake.sender.address,
    ...intake.recipients.map((recipient) => recipient.address),
  ];

  for (const address of people) {
    const domain = domainOf(address);
    const hit = domain && config.blockedDomains.find((b) => domainMatches(domain, b));
    if (hit) {
      return {
        pass: false,
        code: "blocked-domain",
        reason: `Involves a blocked domain (${hit}): ${address}`,
      };
    }
  }

  if (intake.source === "manual") {
    // A paste has no reliable From/To, and a pasted mail often carries the
    // whole header block, so addresses inside the text count as well.
    for (const found of `${intake.subject}\n${intake.body.text}`.matchAll(
      PASTED_ADDRESS,
    )) {
      const domain = found[1].toLowerCase();
      const hit = config.blockedDomains.find((b) => domainMatches(domain, b));
      if (hit) {
        return {
          pass: false,
          code: "blocked-domain",
          reason: `Pasted text mentions an address on a blocked domain (${hit}): ${found[0]}`,
        };
      }
    }
  }

  const haystack = `${intake.subject}\n${intake.body.text}`.toLowerCase();
  for (const term of config.blockedTerms) {
    const needle = term.trim().toLowerCase();
    if (needle && haystack.includes(needle)) {
      return {
        pass: false,
        code: "blocked-term",
        reason: `Contains a blocked term (${term}).`,
      };
    }
  }

  if (intake.source === "teams") {
    const { tenantId, chatId } = teamsIdsOf(intake);
    const tenantOk =
      tenantId !== undefined &&
      config.allowedTenantIds.some((allowed) => sameId(tenantId, allowed));
    const chatOk =
      chatId !== undefined &&
      config.teamsChatAllowlist.some((allowed) => sameId(chatId, allowed));
    if (!tenantOk && !chatOk) {
      return tenantId !== undefined
        ? {
            pass: false,
            code: "tenant-not-allowed",
            reason: `Teams tenant ${tenantId} is not on the allowed list.`,
          }
        : {
            pass: false,
            code: "teams-not-allowlisted",
            reason:
              "Teams message has no tenant ID or chat ID on the allowed list (Teams is filtered by default).",
          };
    }
  } else if (intake.source === "outlook") {
    const domain = domainOf(intake.sender.address);
    if (!domain) {
      return {
        pass: false,
        code: "sender-domain-not-allowed",
        reason: "Email has no readable sender address, so it cannot be checked.",
      };
    }
    if (!config.allowedSenderDomains.some((allowed) => domainMatches(domain, allowed))) {
      return {
        pass: false,
        code: "sender-domain-not-allowed",
        reason: `Sender domain ${domain} is not on the allowed list.`,
      };
    }
  }
  // source "manual": typed or pasted by the user themselves, so the user has
  // vouched for it: only the blocked-domain / blocked-term rules above apply.
  // In particular the Teams default-deny does NOT apply to a paste, even one
  // whose context.origin says "teams".

  return { pass: true };
}

/** Teams items are filtered until a tenant or chat is allowlisted. */
export function teamsIsFiltering(
  config: Pick<FilterConfig, "allowedTenantIds" | "teamsChatAllowlist">,
): boolean {
  return config.allowedTenantIds.length === 0 && config.teamsChatAllowlist.length === 0;
}
