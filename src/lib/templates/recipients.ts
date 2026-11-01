// To / Cc lines of a template. They are stored as one line of text, "Name <a@x.com>; Name <b@x.com>",
// and shown as one chip per recipient. Pure (see recipients.test.mjs).

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const PLACEHOLDER = /^\{\{\s*[\w.]+\s*\}\}$/;

/** The recipients in a stored line. A comma ends one only after its address
 *  ("a@x.com, b@x.com"), so "Last, First <a@x.com>" stays whole. */
export function splitRecipients(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let inAngle = false;
  let inQuote = false;
  const flush = () => {
    const entry = current.trim();
    if (entry) out.push(entry);
    current = "";
  };
  for (const ch of text) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") inAngle = true;
    else if (!inQuote && ch === ">") inAngle = false;
    const top = !inQuote && !inAngle;
    if (top && (ch === ";" || ch === "\n" || ch === "\r")) flush();
    else if (top && ch === "," && current.includes("@")) flush();
    else current += ch;
  }
  flush();
  return out;
}

/** The stored line for a list of recipients, in the form the app has always saved. */
export const joinRecipients = (recipients: readonly string[]): string =>
  recipients.join("; ");

/** Splits every entry again (a pasted "a, b" is two recipients) and drops repeats. */
export function tidyRecipients(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  return entries.flatMap(splitRecipients).filter((entry) => {
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Why one recipient is not usable, or null. An address may be a {{placeholder}} the task fills in. */
export function recipientError(entry: string): string | null {
  const inBrackets = entry.match(/<([^<>]*)>\s*$/);
  const address = (inBrackets ? inBrackets[1] : entry).trim();
  return ADDRESS.test(address) || PLACEHOLDER.test(address)
    ? null
    : "Not an email address";
}

/** One message for a whole line when any recipient is not usable. */
export function recipientsProblem(line: string): string | null {
  const bad = splitRecipients(line).filter((entry) => recipientError(entry) !== null);
  if (bad.length === 0) return null;
  return bad.length === 1
    ? `“${bad[0]}” is not an email address.`
    : `${bad.length} entries are not email addresses.`;
}
