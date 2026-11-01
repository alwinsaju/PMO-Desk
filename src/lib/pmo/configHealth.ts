// Already-saved config can hold values the setup now refuses (an older build
// or a hand edit accepted them). Loading never fails on them; this finds them
// so the UI can flag them, and builds the one-click "Allow <domain>" patch
// without carrying them along.
import {
  checkDomain,
  checkEmail,
  parseDomainList,
  type Checked,
} from "./listValidation.ts";

export type ConfigListField = "allowedSenderDomains" | "blockedDomains" | "emails";

export interface MalformedEntry {
  field: ConfigListField;
  value: string;
  reason: string;
}

interface Lists {
  allowedSenderDomains?: unknown;
  blockedDomains?: unknown;
  me?: { emails?: unknown } | null;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function problems(
  field: ConfigListField,
  values: unknown[],
  check: (v: string) => Checked,
) {
  const found: MalformedEntry[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      found.push({ field, value: "", reason: "Not text" });
      continue;
    }
    if (value.trim() === "") continue;
    const result = check(value);
    if (!result.ok) found.push({ field, value, reason: result.reason });
  }
  return found;
}

/** Every saved email / domain that would not be accepted today. */
export function malformedConfigEntries(config: Lists): MalformedEntry[] {
  return [
    ...problems("allowedSenderDomains", asList(config.allowedSenderDomains), checkDomain),
    ...problems("blockedDomains", asList(config.blockedDomains), checkDomain),
    ...problems("emails", asList(config.me?.emails), checkEmail),
  ];
}

export type AllowDomainPlan =
  | {
      ok: true;
      patch: { allowedSenderDomains: string[] };
      /** Malformed entries left out of the new list (they could never match mail). */
      dropped: string[];
    }
  | { ok: false; reason: string };

/** "Allow <domain>": the domain is checked like a typed one, and the saved list
 *  is sent back normalised without its malformed entries (the server refuses a
 *  list that still holds one). */
export function allowDomainPlan(
  config: Pick<Lists, "allowedSenderDomains">,
  domain: string,
): AllowDomainPlan {
  const checked = checkDomain(domain);
  if (!checked.ok) return { ok: false, reason: `"${domain}": ${checked.reason}` };
  const saved = parseDomainList(
    asList(config.allowedSenderDomains).filter((v): v is string => typeof v === "string"),
    { max: Number.MAX_SAFE_INTEGER },
  );
  return {
    ok: true,
    patch: {
      allowedSenderDomains: saved.valid.includes(checked.value)
        ? saved.valid
        : [...saved.valid, checked.value],
    },
    dropped: saved.invalid.map((issue) => issue.value),
  };
}
