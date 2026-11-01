// Who the lock screen greets: the name configured in PMO To-Do, else the first name of
// the computer's user. Pure: the store fetches, this decides.

export interface Identity {
  /** What to show ("Priya Sharma", "Alex"); empty when nothing usable is known. */
  name: string;
  /** One or two capitals for the avatar; empty when there is no name. */
  initials: string;
}

// Accounts that say nothing about the person.
const GENERIC = new Set([
  "administrator",
  "admin",
  "user",
  "owner",
  "guest",
  "default",
  "root",
  "system",
  "pc",
]);

const titleCase = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** "ACME\\priya.sharma" -> "Priya"; "alexj" -> "Alexj"; "Administrator" -> "". */
export function firstNameFromAccount(account: string | null | undefined): string {
  const bare = (account ?? "").split(/[\\/]/).pop() ?? "";
  const word = bare.split(/[^\p{L}]+/u).find(Boolean) ?? "";
  if (word.length < 2 || GENERIC.has(word.toLowerCase())) return "";
  return titleCase(word);
}

export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function resolveIdentity(input: {
  /** `me.names` from the PMO configuration. */
  pmoNames?: readonly string[] | null;
  /** The computer's account name from the platform info. */
  account?: string | null;
}): Identity {
  const configured = (input.pmoNames ?? []).map((n) => n.trim()).find(Boolean);
  const name = configured || firstNameFromAccount(input.account);
  return { name, initials: initialsOf(name) };
}
