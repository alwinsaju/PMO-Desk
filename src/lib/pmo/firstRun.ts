// The PMO first-run wizard's pure parts: what to ask, how a form becomes
// config, and the rule that tells an upgraded install it is already set up.
// No I/O and no React, so the UI, the server routes and the tests share it.
import { z } from "zod";
import { nameFromEmail } from "../staff/employees.ts";
import { checkEmail, parseDomainList, parseEmailList } from "./listValidation.ts";
import { isValidTimeZone } from "./time.ts";
import { DomainEntrySchema, EmailEntrySchema } from "./types.ts";

export const FIRST_RUN_STEPS = [
  { id: "who", title: "Who are you?" },
  { id: "timeZone", title: "Which time zone?" },
  { id: "domains", title: "Which sender domains do you receive work mail from?" },
  { id: "inbox", title: "Inbox folder" },
] as const;
export type FirstRunStepId = (typeof FIRST_RUN_STEPS)[number]["id"];

export interface FirstRunForm {
  fullName: string;
  /** Short names and other spellings, comma separated. */
  otherNames: string;
  email: string;
  timeZone: string;
  /** Comma separated. */
  allowedDomains: string;
  /** Comma separated; may be empty. */
  blockedDomains: string;
  inboxDir: string;
}

/** What the wizard saves: the pieces of the PMO config it fills in. */
export interface FirstRunPayload {
  names: string[];
  emails: string[];
  timeZone: string;
  allowedSenderDomains: string[];
  blockedDomains: string[];
  inboxDir: string;
}

type Env = Record<string, string | undefined>;

const hasEntry = (list: string[]) => list.some((entry) => entry !== "");

/** What POST /api/pmo/setup accepts: a FirstRunPayload, checked again on the
 *  server. `inboxDir` may be left out only when the environment fixes the inbox. */
export const FirstRunBodySchema = z.object({
  names: z
    .array(z.string().trim().min(1).max(120))
    .min(1, "Add at least one name.")
    .max(50),
  emails: z
    .array(EmailEntrySchema)
    .max(10)
    .refine(hasEntry, { message: "Enter your work email address." }),
  timeZone: z.string().trim().max(64).refine(isValidTimeZone, {
    message: "Not a time zone name (for example Asia/Kolkata).",
  }),
  allowedSenderDomains: z
    .array(DomainEntrySchema)
    .max(200)
    .refine(hasEntry, { message: "Enter at least one sender domain." }),
  blockedDomains: z.array(DomainEntrySchema).max(200),
  inboxDir: z.string().trim().max(500).optional(),
  confirmNonEmpty: z.boolean().optional(),
});
export type FirstRunBody = z.output<typeof FirstRunBodySchema>;

/** Entries of a typed list, de-duplicated ignoring case (first spelling wins). */
export function splitList(
  text: string,
  options: { commasOnly?: boolean } = {},
): string[] {
  const parts = text.split(options.commasOnly ? /[,;\n]+/ : /[,;\s]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part.trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }
  return out;
}

/** The domain of an address, lower-cased; null when it is not an address. */
export function domainOfEmail(email: string): string | null {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The domain of the work email, offered as the sender-domain answer. It is a
 *  suggestion the person accepts (a button, or "Skip for now"), never put into
 *  the box on its own: text typed into a pre-filled box gets appended to it. */
export function suggestedDomain(form: FirstRunForm): string | null {
  const domain = domainOfEmail(form.email);
  const checked = domain ? parseDomainList(domain) : null;
  return checked && checked.valid.length === 1 ? checked.valid[0] : null;
}

/** The sender-domain answer with the suggestion taken, unless the person already typed something. */
export function withSuggestedDomain(form: FirstRunForm): FirstRunForm {
  if (form.allowedDomains.trim() !== "") return form;
  const domain = suggestedDomain(form);
  return domain ? { ...form, allowedDomains: domain } : form;
}

const SYSTEM_USER_NAMES = new Set([
  "administrator",
  "admin",
  "system",
  "user",
  "owner",
  "default",
]);

const LOGIN_WORD = /^\p{L}+$/u;

/** The Windows user name split into capitalised words (`pat.example` ->
 *  ["Pat", "Example"]); empty for a missing or system name. */
function loginWords(env: Env): string[] {
  const raw = (env.USERNAME ?? env.USER ?? "").trim();
  if (!raw || SYSTEM_USER_NAMES.has(raw.toLowerCase())) return [];
  return raw
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** A "your name" pre-fill from the Windows user name (`pat.example` -> "Pat
 *  Example"). Only when it looks like a first and last name: a one-word login
 *  ("Alsaju", "jsmith01") is a username, not a name, and is left to
 *  `loginNameHint`. */
export function suggestedFullName(env: Env): string {
  const words = loginWords(env);
  return words.length >= 2 && words.every((word) => LOGIN_WORD.test(word))
    ? words.join(" ")
    : "";
}

/** What the login looks like as a name, for the box's placeholder when it is
 *  not good enough to pre-fill. */
export function loginNameHint(env: Env): string {
  return loginWords(env).join(" ");
}

/** What to call someone who gave only their address: "jane.doe@x.com" -> "Jane Doe". */
export function nameToGoBy(email: string): string {
  const { firstName, lastName } = nameFromEmail(email);
  return `${firstName} ${lastName}`.trim() || email.split("@")[0] || "";
}

export function initialFirstRunForm(options: {
  suggestedName: string;
  detectedTimeZone: string;
}): FirstRunForm {
  return {
    fullName: options.suggestedName,
    otherNames: "",
    email: "",
    timeZone: options.detectedTimeZone,
    allowedDomains: "",
    blockedDomains: "",
    inboxDir: "",
  };
}

/** Zones for the picker: the supported list, with the detected one always
 *  present. Sorted so it can be scanned. */
export function timeZoneChoices(
  supported: readonly string[],
  detected: string,
): string[] {
  return [...new Set([...supported, ...(detected ? [detected] : [])])].sort();
}

const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

/** What is wrong with one step's answers, in plain words; empty = fine. */
export function stepProblems(step: FirstRunStepId, form: FirstRunForm): string[] {
  const problems: string[] = [];
  switch (step) {
    case "who": {
      // The full name is optional: the M365 profile brings it. Until then the name comes
      // from the address (jane.doe@x.com -> Jane Doe).
      const email = checkEmail(form.email);
      if (form.email.trim() === "") {
        problems.push("Enter your work email address, for example you@company.com.");
      } else if (!email.ok) {
        problems.push(`Your work email address: ${email.reason}.`);
      }
      break;
    }
    case "timeZone":
      if (!isValidTimeZone(form.timeZone.trim())) {
        problems.push("Choose a time zone from the list.");
      }
      break;
    case "domains": {
      const allowed = parseDomainList(form.allowedDomains);
      const blocked = parseDomainList(form.blockedDomains);
      if (allowed.valid.length === 0 && allowed.invalid.length === 0) {
        problems.push("Enter at least one sender domain, for example company.com.");
      }
      for (const issue of [...allowed.invalid, ...blocked.invalid]) {
        problems.push(`"${issue.value}": ${issue.reason}.`);
      }
      break;
    }
    case "inbox": {
      const dir = form.inboxDir.trim().replace(/^"(.*)"$/, "$1");
      if (!dir) problems.push("Choose the inbox folder.");
      else if (!ABSOLUTE_PATH.test(dir)) {
        problems.push(
          "Use the full path of the folder, for example C:\\Users\\you\\OneDrive\\PMO-Inbox.",
        );
      }
      break;
    }
  }
  return problems;
}

export type FirstRunResult =
  { ok: true; payload: FirstRunPayload } | { ok: false; problems: string[] };

export function firstRunPayload(form: FirstRunForm): FirstRunResult {
  const problems = FIRST_RUN_STEPS.flatMap((step) => stepProblems(step.id, form));
  if (problems.length > 0) return { ok: false, problems };
  const emails = parseEmailList([form.email]).valid;
  const names = splitList(
    [
      form.fullName.trim() || nameToGoBy(emails[0] ?? ""),
      ...splitList(form.otherNames, { commasOnly: true }),
    ].join(","),
    { commasOnly: true },
  );
  return {
    ok: true,
    payload: {
      names,
      emails,
      timeZone: form.timeZone.trim(),
      allowedSenderDomains: parseDomainList(form.allowedDomains).valid,
      blockedDomains: parseDomainList(form.blockedDomains).valid,
      inboxDir: form.inboxDir.trim().replace(/^"(.*)"$/, "$1"),
    },
  };
}

/** Show the wizard (and keep the scanner idle) until the person has finished it. */
export function needsFirstRun(
  config: { setupComplete?: boolean } | null | undefined,
): boolean {
  return config?.setupComplete !== true;
}

/** `setupComplete` for a config.json read from disk. A file that predates the
 *  wizard has no such key: it counts as set up when it already names an owner
 *  email and an inbox folder, so an upgrade does not ask again. */
export function inferSetupComplete(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const saved = raw as Record<string, unknown>;
  if (typeof saved.setupComplete === "boolean") return saved.setupComplete;
  const me = saved.me as { emails?: unknown } | null | undefined;
  const emails = typeof me === "object" && me !== null ? me.emails : undefined;
  const hasEmail =
    Array.isArray(emails) && emails.some((e) => typeof e === "string" && e.trim() !== "");
  const hasInbox = typeof saved.inboxDir === "string" && saved.inboxDir.trim() !== "";
  return hasEmail && hasInbox;
}
