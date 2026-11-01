// The one place that decides what counts as an email address or a sender
// domain in PMO setup and settings. Pure (no I/O, no React), so the wizard, the
// Settings dialog, the Filtered tab and the server routes share it. A list that
// slips through here silently filters (and discards) every mail, so each entry
// is checked and normalised: lower-case, no leading "@", no trailing dot.

export interface ListIssue {
  /** The entry as typed (shortened when very long). */
  value: string;
  reason: string;
}

export interface ParsedList {
  /** Normalised, de-duplicated, in the order typed. */
  valid: string[];
  invalid: ListIssue[];
}

export type Checked = { ok: true; value: string } | { ok: false; reason: string };

export const MAX_LIST_ENTRIES = 200;
/** More text than this is cut off before it is looked at. */
export const MAX_LIST_INPUT_CHARS = 20_000;
const MAX_SHOWN_CHARS = 80;
const MAX_EMAIL_CHARS = 254;
const MAX_LOCAL_PART_CHARS = 64;
const MAX_DOMAIN_CHARS = 253;

export const NOT_EMAIL = "Not an email address (example: name@company.com)";
export const NOT_DOMAIN = "Not a domain (example: company.com)";
export const JOINED_EMAILS = "Looks like two addresses joined together";
export const JOINED_DOMAINS = "Looks like two domains joined together";
export const DOUBLED_DOMAIN =
  "Looks like the domain was typed twice (example: company.com)";
const NON_ASCII = "Use plain letters, digits and hyphens only (no accents or symbols)";
const IS_EMAIL = "That is an email address; enter only the domain (example: company.com)";
const WILDCARD = "No wildcard needed: an allowed domain also matches its subdomains";

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,63}$`);
const NON_ASCII_CHAR = /[^\u0020-\u007e]/;
const LOCAL_PART = /^[^\s@<>"',;()[\]\\:]+$/;

const shown = (value: string) =>
  value.length > MAX_SHOWN_CHARS ? `${value.slice(0, MAX_SHOWN_CHARS)}...` : value;

/** "deloitte.comdeloitte.com": two domains run together, the usual result of
 *  typing into a box that was pre-filled. Needs the second half to start with
 *  the first one's own first label, so "a.compass.com" is not mistaken for it. */
function looksDoubled(domain: string): boolean {
  for (let split = 4; split < domain.length - 3; split++) {
    const head = domain.slice(0, split);
    const tail = domain.slice(split);
    if (!DOMAIN.test(head) || !DOMAIN.test(tail)) continue;
    if (tail.startsWith(`${head.slice(0, head.indexOf("."))}.`)) return true;
  }
  return false;
}

const hasSeparator = (value: string) => /[\s,;]/.test(value);

/** One domain as typed ("@Company.com.", "company.com") -> "company.com". */
export function checkDomain(raw: string): Checked {
  const value = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.+$/, "");
  if (value === "") return { ok: false, reason: NOT_DOMAIN };
  if (hasSeparator(value)) return { ok: false, reason: JOINED_DOMAINS };
  if (value.includes("@")) return { ok: false, reason: IS_EMAIL };
  if (value.startsWith("*")) return { ok: false, reason: WILDCARD };
  if (NON_ASCII_CHAR.test(value)) return { ok: false, reason: NON_ASCII };
  if (value.length > MAX_DOMAIN_CHARS || !DOMAIN.test(value)) {
    return { ok: false, reason: NOT_DOMAIN };
  }
  if (looksDoubled(value)) return { ok: false, reason: DOUBLED_DOMAIN };
  return { ok: true, value };
}

/** One address as typed ("Pat <Pat@Company.com>", "pat@company.com.") -> "pat@company.com". */
export function checkEmail(raw: string): Checked {
  const bracketed = /^[^<>]*<([^<>]+)>$/.exec(raw.trim());
  const value = (bracketed ? bracketed[1] : raw)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .replace(/\.+$/, "");
  if (hasSeparator(value)) return { ok: false, reason: JOINED_EMAILS };
  const at = value.split("@");
  if (at.length > 2) return { ok: false, reason: JOINED_EMAILS };
  if (at.length < 2) return { ok: false, reason: NOT_EMAIL };
  const [local, domain] = at;
  if (NON_ASCII_CHAR.test(value)) return { ok: false, reason: NON_ASCII };
  if (
    value.length > MAX_EMAIL_CHARS ||
    local.length > MAX_LOCAL_PART_CHARS ||
    !LOCAL_PART.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !DOMAIN.test(domain)
  ) {
    return { ok: false, reason: NOT_EMAIL };
  }
  if (looksDoubled(domain)) return { ok: false, reason: DOUBLED_DOMAIN };
  return { ok: true, value };
}

/** "Pat <pat@x.com>, Sam <sam@x.com>" -> " pat@x.com ,  sam@x.com " so the split sees plain addresses. */
const unwrapNamedAddresses = (text: string) =>
  text.replace(/[^,;\r\n<>]*<([^<>\s]+)>/g, " $1 ");

interface ParseOptions {
  /** Most valid entries kept; the rest are reported as one problem. */
  max?: number;
}

function parseList(
  input: string | readonly string[],
  check: (entry: string) => Checked,
  isEmail: boolean,
  { max = MAX_LIST_ENTRIES }: ParseOptions,
): ParsedList {
  const valid: string[] = [];
  const invalid: ListIssue[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();
  let entries: readonly string[];
  if (typeof input === "string") {
    const text = input.slice(0, MAX_LIST_INPUT_CHARS);
    entries = (isEmail ? unwrapNamedAddresses(text) : text).split(/[\s,;]+/);
    if (input.length > MAX_LIST_INPUT_CHARS) {
      invalid.push({
        value: "(the rest of the text)",
        reason: `Too much text: only the first ${MAX_LIST_INPUT_CHARS} characters were read`,
      });
    }
  } else {
    entries = input;
  }

  let overflow = 0;
  for (const entry of entries) {
    if (entry.trim() === "") continue;
    const result = check(entry);
    if (result.ok) {
      if (seenValid.has(result.value)) continue;
      seenValid.add(result.value);
      if (valid.length < max) valid.push(result.value);
      else overflow++;
    } else if (!seenInvalid.has(entry) && invalid.length < max) {
      seenInvalid.add(entry);
      invalid.push({ value: shown(entry.trim()), reason: result.reason });
    }
  }
  if (overflow > 0) {
    invalid.push({
      value: `${overflow} more`,
      reason: `Too many entries (at most ${max})`,
    });
  }
  return { valid, invalid };
}

/** A typed list of addresses (newline, comma, semicolon or space separated),
 *  or an array holding one address per element. */
export const parseEmailList = (
  input: string | readonly string[],
  options: ParseOptions = {},
) => parseList(input, checkEmail, true, options);

/** The same for domains. */
export const parseDomainList = (
  input: string | readonly string[],
  options: ParseOptions = {},
) => parseList(input, checkDomain, false, options);
