// Turns a server refusal that still carries validation wording ("Invalid change: title:
// Too big: expected string to have <=200 characters", "Invalid email address
// (upsert.0.deloitteEmail)") into a sentence a PMO person can act on. A reason that
// is already plain is returned unchanged. Pure and client-safe.

const LABELS: Record<string, string> = {
  title: "The title",
  description: "The description",
  subject: "The subject",
  body: "The pasted text",
  from: "The sender",
  owner: "The owner",
  requester: "The requester",
  waitingOn: "The “waiting on” name",
  notes: "The note",
  note: "The note",
  quote: "The quote",
  name: "The name",
  names: "The names",
  emails: "The email addresses",
  email: "The email address",
  dueAt: "The due date",
  tags: "The tags",
  reason: "The reason",
};

const humanise = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();

/** "The title" for "title", "The deloitte email" for "upsert.0.deloitteEmail". */
function labelFor(path: string): string {
  const parts = path.split(".").filter((part) => part && !/^\d+$/.test(part));
  const last = parts[parts.length - 1] ?? "";
  return LABELS[last] ?? (last ? `The ${humanise(last)}` : "That entry");
}

const PREFIX = /^Invalid (?:change|to-do|request|config|setup|update|note)\s*:\s*/i;
const TRAILING_PATH = /\s*\((?:[\w-]+\.)+[\w-]+\)\s*$/;
const FIELD_PREFIX = /^([a-z][\w]*(?:\.[\w]+)*):\s+([\s\S]+)$/;
const GENERIC =
  "Something you entered is not in a form PMO Desk accepts. Check the entries and try again.";

const RAW_ZOD =
  /\b(?:expected|received)\b|Too (?:big|small)\b|Invalid (?:input|option|string|literal|union)/i;

function rewrite(message: string, field: string): string | null {
  const label = labelFor(field);
  let m = /Too big: expected string to have <=\s*(\d+) characters?/i.exec(message);
  if (m) return `${label} is too long. Use ${m[1]} characters or fewer.`;
  m = /Too small: expected string to have >=\s*(\d+) characters?/i.exec(message);
  if (m) {
    return Number(m[1]) <= 1
      ? `${label} cannot be empty.`
      : `${label} is too short. Use at least ${m[1]} characters.`;
  }
  m = /Too big: expected array to have <=\s*(\d+) items?/i.exec(message);
  if (m)
    return `There are too many entries in ${label.toLowerCase()}. The limit is ${m[1]}.`;
  m = /Too small: expected array to have >=\s*(\d+) items?/i.exec(message);
  if (m) return `Add at least ${m[1]} for ${label.toLowerCase()}.`;
  if (/Invalid email/i.test(message)) {
    return "One of the email addresses does not look right. Check it and try again.";
  }
  if (/Invalid input: expected \w+, received (?:undefined|null)/i.test(message)) {
    return `${label} is missing.`;
  }
  if (
    /Invalid (?:option|literal|union)|Invalid string|Invalid (?:ISO )?date/i.test(message)
  ) {
    return `${label} is not valid. Check it and try again.`;
  }
  return RAW_ZOD.test(message) ? GENERIC : null;
}

export function friendlyReason(reason: string): string {
  let text = reason.trim();
  if (!text) return text;
  const before = text;
  text = text.replace(PREFIX, "").replace(TRAILING_PATH, "");
  // An email message names its path only in brackets, e.g. "Invalid email address (upsert.0.x)".
  const bare = /^Invalid email/i.test(text) ? rewrite(text, "") : null;
  if (bare) return bare;
  const match = FIELD_PREFIX.exec(text);
  if (match) {
    const rewritten = rewrite(match[2], match[1]);
    if (rewritten) return rewritten;
    return match[2];
  }
  const rewritten = rewrite(text, "");
  if (rewritten) return rewritten;
  return text === before ? reason : text;
}
