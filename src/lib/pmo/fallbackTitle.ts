// Deterministic titles for when the model's is unusable (empty, a bare
// "Hi,"/"Rohan," or just the sender's name). The subject line is the best
// title a mail has; without one, the first real sentence of the body, after the
// greeting, the quoted chain and the signature are taken away. English and
// French greetings. Pure and client-safe: no I/O, no clock.

export const MAX_FALLBACK_TITLE = 200;

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

// A prefix a mail client or gateway adds: "RE:", "Fwd:", "[External]".
const SUBJECT_PREFIX =
  /^\s*(?:\[(?:external|ext|caution|spam|secure|encrypted|confidential)[^\]]{0,40}\]|(?:re|fw|fwd|aw|wg|tr|sv)\s*:)\s*/i;

function stripSubjectPrefixes(subject: string): string {
  let out = squash(subject);
  for (let i = 0; i < 12; i++) {
    const next = out.replace(SUBJECT_PREFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

const GREETING =
  /^(?:good\s+(?:morning|afternoon|evening)|hi|hello|hey|dear|greetings|bonjour|bonsoir|salut|coucou|cher|ch[èe]re|chers|ch[èe]res|hola|hallo)(?![\p{L}\p{N}])/iu;
// Where a greeting's name ends: "Hi Alex," "Hello team!" "Hi Alex - could you".
const SALUTATION_END = /[,!:;]|\s[-–—]\s/;
const MAX_SALUTATION_WORDS = 6;
const NAME_LINE =
  /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:and|et|&)?\s*\p{Lu}[\p{L}'’.-]*){0,3}\s*[,:;!]$/u;

/** What follows a leading greeting on this line ("Hi Alex, could you" ->
 *  "could you"), "" if the line is only a greeting or a name, or null if the
 *  line does not start with one. */
function stripSalutation(line: string): string | null {
  const text = line.trim();
  const greeting = GREETING.exec(text);
  if (!greeting) return NAME_LINE.test(text) ? "" : null;
  const rest = text.slice(greeting[0].length);
  const end = SALUTATION_END.exec(rest);
  const name = end ? rest.slice(0, end.index) : rest;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > MAX_SALUTATION_WORDS || /[?]/.test(name)) return null;
  if (!end) return words.length <= 4 && !/[.]\s/.test(name) ? "" : null;
  return rest.slice(end.index + end[0].length).replace(/^[\s,!:;]+/, "");
}

/** The line without any greetings at its start ("Bonjour Madame, Monsieur," -> ""). */
function dropSalutations(line: string): string {
  let out = line.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripSalutation(out);
    if (next === null) break;
    out = next.trim();
  }
  return out;
}

/** Is this text nothing but a greeting or a person's name ("Hi,", "Rohan,")? */
export function isSalutationOnly(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => dropSalutations(line) === "");
}

const FOLD_MARKS = /\p{M}+/gu;
const nameKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(FOLD_MARKS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The keys by which a title counts as "just somebody's name": the whole name,
 *  its first and last word, and the part of an address before the @. */
function identityKeys(values: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const local = value.includes("@") ? value.split("@")[0] : value;
    const key = nameKey(value);
    if (!key) continue;
    keys.add(key);
    keys.add(nameKey(local));
    const words = nameKey(local).split(" ");
    if (words.length > 1) {
      for (const word of [words[0], words[words.length - 1]]) {
        if (word.length >= 2) keys.add(word);
      }
    }
  }
  return keys;
}

/** Is the model's title unusable: empty, no letters at all, a greeting, or only
 *  the name of someone involved (`knownNames`: the sender, the user)? */
export function isPoorTitle(title: string, knownNames: readonly string[] = []): boolean {
  const text = squash(title);
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  if (isSalutationOnly(text)) return true;
  return identityKeys(knownNames).has(nameKey(text));
}

/** Cut to `max` characters (never inside an emoji), at a word if there is one
 *  near the end, with an ellipsis. */
function cap(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s.,;:!-]+$/, "")}…`;
}

// Where the sender's own words end: the quoted chain, a signature, a closing.
const CUT_LINE = [
  /^\s*-{2,}\s*(?:original message|forwarded message|message d.origine|message transf[ée]r[ée])/i,
  /^\s*_{5,}\s*$/,
  /^--\s*$/,
  /^\s*(?:thanks|thank you|many thanks|thanks again|regards|kind regards|best regards|warm regards|best|cheers|sincerely|cordialement|bien cordialement|merci|merci d.avance|bien [àa] vous|sent from my [^\n]*)\s*[,.!]?\s*$/i,
];
const WROTE_LINE = /^[ \t]*(?:On|Le)\s[^]{0,250}?\b(?:wrote|a [ée]crit)\s*:/im;
const HEADER_LINE = /^\s*(?:From|De)\s*:/i;
const HEADER_FOLLOWER = /^\s*(?:Sent|Date|Envoy[ée]|To|[ÀA]|Subject|Objet)\s*:/i;

function ownWords(bodyText: string): string[] {
  const body = bodyText.replace(/\r\n?/g, "\n");
  const wrote = WROTE_LINE.exec(body);
  const lines = (wrote ? body.slice(0, wrote.index) : body).split("\n");
  const own: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CUT_LINE.some((pattern) => pattern.test(line))) break;
    if (
      HEADER_LINE.test(line) &&
      lines.slice(i + 1, i + 5).some((l) => HEADER_FOLLOWER.test(l))
    )
      break;
    if (/^\s*>/.test(line)) continue;
    own.push(line);
  }
  return own;
}

const FILLER = [
  /^(?:i\s+)?(?:hope|trust)\b/i,
  /^j[’']esp[èe]re\b/i,
  /^(?:thanks|thank you|merci)(?:\s+(?:you|so much|again|a lot|beaucoup))?\W*$/i,
];

/** The first sentence of the sender's own words that says something: after the
 *  greeting, ahead of any signature or quoted reply, skipping pleasantries.
 *  Punctuation as written; "" if there is none. */
export function firstMeaningfulSentence(bodyText: string): string {
  const paragraphs = ownWords(bodyText)
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  for (const lines of paragraphs) {
    const rest = [...lines];
    while (rest.length > 0) {
      const next = dropSalutations(rest[0]);
      if (next === rest[0].trim()) break;
      if (next) rest[0] = next;
      else rest.shift();
    }
    const sentences = squash(rest.join(" "))
      .split(/(?<=[.!?…])\s+/)
      .map((sentence) => sentence.trim());
    for (const sentence of sentences) {
      if (!/\p{L}{2,}/u.test(sentence)) continue;
      if (FILLER.some((pattern) => pattern.test(sentence))) continue;
      return sentence;
    }
  }
  return "";
}

/** A title for a message the model could not title: its subject (prefixes like
 *  "RE:" and "[External]" removed), else the first meaningful sentence of the
 *  body. "" when the message has neither. */
export function deriveFallbackTitle(
  message: { subject?: string | null; bodyText?: string | null },
  max = MAX_FALLBACK_TITLE,
): string {
  const subject = stripSubjectPrefixes(message.subject ?? "");
  if (/[\p{L}\p{N}]/u.test(subject) && !isSalutationOnly(subject)) {
    return cap(subject, max);
  }
  const sentence = firstMeaningfulSentence(message.bodyText ?? "").replace(
    /[\s.,;:]+$/,
    "",
  );
  return sentence ? cap(sentence, max) : "";
}
