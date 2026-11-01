// Deterministic clean-up of the model's answer, applied after validation and
// before the proposal is stored. A small local model is good at reading a
// message and bad at calendars and at the difference between "I wait for X" and
// "I must talk to X", so the few mistakes it makes again and again are fixed by
// code, each one recorded in plain words (`adjustments`) so the review dialog can
// say what the app changed. Pure and client-safe: no clock of its own (the caller
// passes `now`), no I/O, and nothing here is ever logged.
import { addIsoDays, istDate } from "./time.ts";
import {
  deriveFallbackTitle,
  firstMeaningfulSentence,
  isPoorTitle,
  isSalutationOnly,
} from "./fallbackTitle.ts";
import type { AiStructured, PmoConfig } from "./types.ts";

export const MAX_ACTION_ITEMS_KEPT = 6;
export const MAX_TAGS_KEPT = 4;
/** The stored title is clipped at this length (AiStructuredSchema). */
const TITLE_MAX = 90;
const DESCRIPTION_MAX = 600;

export interface SanitizeContext {
  /** The moment the message is being read: "today" comes from this. */
  now: Date | string | number;
  /** The reminder time zone; blank or unknown means the default (IST). */
  timeZone?: string;
  /** The words of the message as the model saw them, subject included. */
  text: string;
  me: PmoConfig["me"];
  /** The message's own subject and the text the model read, for the fallback
   *  title. Without them `text` is used. */
  subject?: string;
  bodyText?: string;
  /** Who sent it: a title that is only their name is not a title. */
  sender?: { name?: string | null; address?: string | null };
}

export interface SanitizeResult {
  draft: AiStructured;
  /** Plain-language notes, one per kind of change; empty when nothing changed. */
  adjustments: string[];
  /** The model's title or description was unusable and the app's own was put in
   *  its place: the card says the AI could not structure this message. */
  fallback: boolean;
}

/** Wording that makes a message urgent in its own right. "today" is in on
 *  purpose (it covers "by today" and "end of day today"): a false keep is
 *  harmless, a false downgrade hides something urgent. */
export const URGENCY_WORDS =
  /\b(urgent(?:ly)?|asap|as soon as possible|immediate(?:ly)?|right away|critical|escalat\w*|eod|end of day|by today|today)\b/i;

/** Wording that says the person is the one waiting. */
export const WAITING_WORDS =
  /\b(asked|waiting for|waiting on|awaiting|chase[ds]?|chasing|follow(?:ing)? up|reminder|pending from|get back|revert)\b/i;

const GROUP_OWNER = /^(everyone|everybody|all|both|team|the team|all of you)$/i;
const GROUP_WORDS = new Set([
  "team",
  "group",
  "department",
  "dept",
  "office",
  "desk",
  "committee",
]);

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
const lower = (value: string) => squash(value).toLowerCase();
/** Case, whitespace and punctuation-insensitive form of an action item. */
const itemKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function sameOwner(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && lower(a) === lower(b);
}

function isMe(name: string | null | undefined, me: PmoConfig["me"]): boolean {
  if (!name) return false;
  const n = lower(name);
  if (n === "me") return true;
  return [...me.names, ...me.emails].some((own) => lower(own) === n);
}

function containsWord(haystack: string, needle: string): boolean {
  const h = ` ${itemKey(haystack)} `;
  const n = itemKey(needle);
  return n.length > 0 && h.includes(` ${n} `);
}

/** The strings that stand for `waitingOn` inside other text: the whole thing, and
 *  for a person's name its first name (never for a group like "Finance team",
 *  whose first word is an ordinary word). */
function waitingNeedles(waitingOn: string): string[] {
  const tokens = squash(waitingOn).split(" ");
  const personLike =
    tokens.length >= 2 &&
    tokens.length <= 4 &&
    tokens.every(
      (t) => /^\p{Lu}[\p{L}'.-]+$/u.test(t) && !GROUP_WORDS.has(t.toLowerCase()),
    );
  return personLike && tokens[0].length >= 3
    ? [squash(waitingOn), tokens[0]]
    : [squash(waitingOn)];
}

/** Does the message use waiting wording within ~100 characters of a mention? */
function waitingWordingNear(text: string, needles: string[]): boolean {
  const haystack = text.toLowerCase();
  for (const needle of needles) {
    const target = needle.toLowerCase();
    if (!target) continue;
    for (
      let at = haystack.indexOf(target);
      at !== -1;
      at = haystack.indexOf(target, at + 1)
    ) {
      const window = text.slice(Math.max(0, at - 100), at + target.length + 100);
      if (WAITING_WORDS.test(window)) return true;
    }
  }
  return false;
}

function mergeOwners(owners: (string | null)[]): string | null {
  const seen = new Map<string, string>();
  for (const owner of owners) {
    const name = owner ? squash(owner) : "";
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  const names = [...seen.values()];
  // "Everyone" already covers the named people.
  const group = names.find((n) => GROUP_OWNER.test(n));
  if (group) return group;
  return names.length > 0 ? names.join(" / ") : null;
}

export function sanitizeDraft(input: AiStructured, ctx: SanitizeContext): SanitizeResult {
  const draft: AiStructured = {
    ...input,
    owner: { ...input.owner },
    actionItems: input.actionItems.map((item) => ({ ...item })),
    tags: [...input.tags],
  };
  const adjustments: string[] = [];
  let fallback = false;
  const today = istDate(ctx.now, ctx.timeZone);
  const tomorrow = addIsoDays(today, 1);

  // (0) A title that is no title (empty, "Hi,", the sender's name): the subject
  // line, else the first real sentence, put in its place. A description that is
  // only a greeting gets the same sentence.
  const subject = ctx.subject ?? "";
  const bodyText = ctx.bodyText ?? ctx.text;
  const knownNames = [
    ctx.sender?.name,
    ctx.sender?.address,
    ...ctx.me.names,
    ...ctx.me.emails,
  ].filter((value): value is string => !!value);
  if (isPoorTitle(draft.title, knownNames)) {
    fallback = true;
    const title = deriveFallbackTitle({ subject, bodyText }, TITLE_MAX);
    if (title) {
      draft.title = title;
      adjustments.push(
        "The AI's title was empty, a greeting or only a name, so the subject line is used instead.",
      );
    }
  }
  if (draft.description.trim() && isSalutationOnly(draft.description)) {
    fallback = true;
    draft.description = firstMeaningfulSentence(bodyText).slice(0, DESCRIPTION_MAX);
  }

  // (a) A deadline that had already passed when the message was read. Relative
  // dates are resolved against the day the message was written, so for an old
  // message the answer can be long gone: say so instead of proposing it.
  if (draft.dueAt && draft.dueBasis === "none") {
    draft.dueAt = null; // noise the review form ignores anyway
  } else if (draft.dueAt && draft.dueAt < today) {
    const stated = draft.dueAt;
    const note = `(Stated deadline ${stated} had already passed when this was read.)`;
    draft.description = draft.description.trim()
      ? `${draft.description.trim()} ${note}`
      : note;
    draft.dueAt = null;
    draft.dueBasis = "none";
    adjustments.push(
      `The deadline ${stated} had already passed when this was read, so no due date is set.`,
    );
  }
  const stalePast = draft.actionItems.filter((i) => i.dueAt && i.dueAt < today);
  if (stalePast.length > 0) {
    for (const item of stalePast) item.dueAt = null;
    adjustments.push(
      stalePast.length === 1
        ? "One action item's date had already passed and was removed."
        : `${stalePast.length} action items' dates had already passed and were removed.`,
    );
  }

  // (b) "high" needs the message's own urgency wording, or a deadline of today
  // or tomorrow counted from today.
  if (
    draft.priority === "high" &&
    !URGENCY_WORDS.test(ctx.text) &&
    draft.dueAt !== today &&
    draft.dueAt !== tomorrow
  ) {
    draft.priority = "normal";
    adjustments.push(
      "Priority lowered from high to normal: the message has no urgency wording and no deadline today or tomorrow.",
    );
  }

  // (c) The same step listed twice (typically once per person): one item, the
  // owners joined. Then the cap.
  const merged: AiStructured["actionItems"] = [];
  const groups = new Map<string, AiStructured["actionItems"]>();
  for (const item of draft.actionItems) {
    const text = squash(item.text);
    if (!text) continue;
    const key = itemKey(text) || text.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.push({ ...item, text });
    } else {
      const first = { ...item, text };
      groups.set(key, [first]);
      merged.push(first);
    }
  }
  let duplicates = 0;
  for (const item of merged) {
    const group = groups.get(itemKey(item.text) || item.text.toLowerCase());
    if (!group || group.length < 2) continue;
    duplicates += group.length - 1;
    item.owner = mergeOwners(group.map((g) => g.owner));
    item.dueAt = group.map((g) => g.dueAt).find((d) => d) ?? null;
  }
  if (duplicates > 0) {
    adjustments.push(
      duplicates === 1
        ? "Merged a duplicate action item."
        : `Merged ${duplicates} duplicate action items.`,
    );
  }
  draft.actionItems = merged.slice(0, MAX_ACTION_ITEMS_KEPT);
  if (merged.length > MAX_ACTION_ITEMS_KEPT) {
    adjustments.push(
      `Kept the first ${MAX_ACTION_ITEMS_KEPT} of ${merged.length} action items.`,
    );
  }

  // (d) "Waiting on" is for somebody else's delivery to me. Not on myself, and
  // not on a person I only have to contact (that is my own action item) unless the
  // message itself talks about waiting, asking or chasing near that name.
  const waitingOn = draft.waitingOn ? squash(draft.waitingOn) : "";
  if (waitingOn) {
    const ownerIsMe =
      draft.owner.isMe === true ||
      isMe(draft.owner.name, ctx.me) ||
      isMe(draft.owner.email, ctx.me);
    if (
      isMe(waitingOn, ctx.me) ||
      (ownerIsMe &&
        (sameOwner(waitingOn, draft.owner.name) ||
          sameOwner(waitingOn, draft.owner.email)))
    ) {
      draft.waitingOn = null;
      adjustments.push(`Cleared "waiting on ${waitingOn}": that is you.`);
    } else {
      const needles = waitingNeedles(waitingOn);
      const mine = draft.actionItems.filter(
        (item) => isMe(item.owner, ctx.me) || (!item.owner && draft.owner.isMe === true),
      );
      const ownStep = mine.some((item) =>
        needles.some((n) => containsWord(item.text, n)),
      );
      if (ownStep && !waitingWordingNear(ctx.text, needles)) {
        draft.waitingOn = null;
        adjustments.push(
          `Cleared "waiting on ${waitingOn}": contacting them is your own step, and the message does not say you are waiting for them.`,
        );
      }
    }
  }

  // (e) Tidy tags.
  const tags: string[] = [];
  for (const tag of draft.tags) {
    const clean = squash(tag);
    if (clean && !tags.some((t) => t.toLowerCase() === clean.toLowerCase()))
      tags.push(clean);
  }
  draft.tags = tags.slice(0, MAX_TAGS_KEPT);

  return { draft, adjustments, fallback };
}
