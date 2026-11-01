// Who a message is addressed to, from its opening salutation ("Rohan,", "Hi Rohan and Priya,",
// "Bonjour Zoë,"). A request that opens with somebody else's name is that person's work even when
// the user is on the "to" line, which a small model often misses. Pure and client-safe.
import type { PmoConfig } from "./types.ts";

const GREETING =
  /^(?:good\s+(?:morning|afternoon|evening)|hi|hello|hey|dear|greetings|bonjour|bonsoir|salut|coucou|cher|ch[èe]re|chers|ch[èe]res|hola|hallo)(?![\p{L}\p{N}])/iu;
const SALUTATION_END = /[,!:;]|\s[-–—]\s/;
const NAME_LINE =
  /^(\p{Lu}[\p{L}'’.-]*(?:\s+(?:and|et|&)?\s*\p{Lu}[\p{L}'’.-]*){0,3})\s*[,:;!]$/u;
const NAME_WORD = /^\p{Lu}[\p{L}'’.-]*$/u;
/** Words that address a group or a role, not one person. */
const GROUP = new Set([
  "all",
  "everyone",
  "everybody",
  "both",
  "team",
  "folks",
  "colleagues",
  "guys",
  "there",
  "madame",
  "monsieur",
  "sir",
  "madam",
  "sirs",
  "tous",
  "equipe",
  "équipe",
]);

const clean = (word: string) => word.replace(/[.'’]+$/g, "");

/** The people the opening salutation names, or [] when it names nobody (no greeting, a group,
 *  or anything that is not plainly a name). */
export function addresseesOf(bodyText: string): string[] {
  const first = bodyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return [];
  let names = "";
  const greeting = GREETING.exec(first);
  if (greeting) {
    const rest = first.slice(greeting[0].length);
    const end = SALUTATION_END.exec(rest);
    if (!end) return [];
    names = rest.slice(0, end.index).trim();
  } else {
    names = NAME_LINE.exec(first)?.[1] ?? "";
  }
  if (!names) return [];
  const words = names.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return [];
  const people: string[] = [];
  let current: string[] = [];
  for (const raw of words) {
    if (/^(and|et|&)$/i.test(raw)) {
      if (current.length) people.push(current.join(" "));
      current = [];
      continue;
    }
    if (!NAME_WORD.test(raw) || GROUP.has(clean(raw).toLowerCase())) return [];
    current.push(clean(raw));
  }
  if (current.length) people.push(current.join(" "));
  return people;
}

/** Name parts that stand for the user: the words of the configured names and the pieces of the
 *  configured addresses ("alex.morgan@x.com" -> alex, morgan). */
function myTokens(me: PmoConfig["me"]): Set<string> {
  const tokens = new Set<string>();
  for (const name of me.names) {
    for (const part of name.toLowerCase().split(/[\s.,]+/)) if (part) tokens.add(part);
  }
  for (const email of me.emails) {
    for (const part of email
      .toLowerCase()
      .split("@")[0]
      .split(/[._+-]+/)) {
      if (part) tokens.add(part);
    }
  }
  return tokens;
}

/** Does the salutation name somebody other than the user (and nobody who is the user)? */
export function addressedToSomeoneElse(
  bodyText: string,
  me: PmoConfig["me"],
): string[] | null {
  const people = addresseesOf(bodyText);
  if (people.length === 0) return null;
  const mine = myTokens(me);
  const names = people.filter(Boolean);
  const isMine = (person: string) =>
    person
      .toLowerCase()
      .split(/\s+/)
      .some((word) => mine.has(word));
  return names.some(isMine) ? null : names;
}
