// A deterministic check of the model's due date against the sentence it quoted. A small
// model reads "by Friday" fine but often counts the days wrong, so when the quote itself
// names a weekday, "today", "tomorrow", "yesterday" or an explicit calendar date, the
// date is worked out here (in the configured time zone, via `today`) and wins over a
// model date that disagrees. Pure and client-safe; English wording only: anything the
// check does not recognise leaves the model's date alone.
import { addIsoDays, isRealIsoDay } from "./time.ts";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAY_WORD =
  "(sunday|monday|tuesday|tues|tue|wednesday|thursday|thurs|thur|thu|friday|fri|saturday)";
const MONTH_WORD =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

interface Mention {
  /** The date this wording most likely means. */
  primary: string;
  /** Other readings that are just as fair and must not be "corrected". */
  allowed: string[];
}

const dayOfWeek = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** "Fri 6 Nov" for a YYYY-MM-DD day. */
export function dayWords(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAY_NAMES[dayOfWeek(iso)]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
function realDay(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return y >= 2000 && y <= 2100 && isRealIsoDay(iso) ? iso : null;
}

const firstAfter = (today: string, weekday: number): string => {
  const gap = (weekday - dayOfWeek(today) + 7) % 7 || 7;
  return addIsoDays(today, gap);
};

/** A day-and-month with no year: this year's, or next year's if this year's has passed. */
function yearless(today: string, m: number, d: number): Mention | null {
  const year = Number(today.slice(0, 4));
  const thisYear = realDay(year, m, d);
  const nextYear = realDay(year + 1, m, d);
  if (!thisYear || !nextYear) return thisYear ? { primary: thisYear, allowed: [] } : null;
  const primary = thisYear >= today ? thisYear : nextYear;
  return { primary, allowed: [thisYear, nextYear] };
}

function weekdayMentions(text: string, today: string): Mention[] {
  const out: Mention[] = [];
  const pattern = new RegExp(
    `(?:\\b(next|this|last|every|each|coming)\\s+)?\\b${WEEKDAY_WORD}\\b(?!s\\b)`,
    "gi",
  );
  for (const match of text.matchAll(pattern)) {
    const qualifier = (match[1] ?? "").toLowerCase();
    if (qualifier === "last" || qualifier === "every" || qualifier === "each") continue;
    const weekday = WEEKDAYS[match[2].toLowerCase()]!;
    const after = firstAfter(today, weekday);
    const sameDay = dayOfWeek(today) === weekday;
    if (qualifier === "this" || qualifier === "coming") {
      const primary = sameDay ? today : after;
      out.push({ primary, allowed: [] });
    } else if (qualifier === "next") {
      out.push({ primary: after, allowed: [addIsoDays(after, 7)] });
    } else {
      // Plain "Friday" is the first one after the day the message was read
      // (the structuring prompt says so); on that weekday itself "today" is fair too.
      out.push({ primary: after, allowed: sameDay ? [today] : [] });
    }
  }
  return out;
}

const NOT_A_DEADLINE_BEFORE =
  /(?:thanks? for|thank you for|since|from|as of|after|spoke|called|met|sent)\s+$/i;
const DEADLINE_BEFORE_YESTERDAY =
  /\b(?:by|before|until|till|due|deadline|needed|needs?|wanted|expected)\s+(?:it\s+|this\s+|that\s+|them\s+)?(?:\w+\s+)?$/i;

function relativeMentions(text: string, today: string): Mention[] {
  const out: Mention[] = [];
  for (const match of text.matchAll(/\b(today|tomorrow|yesterday)\b(?!['’]s)/gi)) {
    const word = match[1].toLowerCase();
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (/day after\s+$/i.test(before) && word === "tomorrow") {
      out.push({ primary: addIsoDays(today, 2), allowed: [] });
      continue;
    }
    if (NOT_A_DEADLINE_BEFORE.test(before)) continue;
    if (/day before\s+$/i.test(before) && word === "yesterday") continue;
    if (word === "yesterday" && !DEADLINE_BEFORE_YESTERDAY.test(before)) continue;
    const offset = word === "today" ? 0 : word === "tomorrow" ? 1 : -1;
    out.push({ primary: addIsoDays(today, offset), allowed: [] });
  }
  return out;
}

function dateMentions(text: string, today: string): Mention[] {
  const out: Mention[] = [];
  const year = (raw: string | undefined): number | null =>
    raw === undefined ? null : raw.length === 2 ? 2000 + Number(raw) : Number(raw);

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = realDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.push({ primary: iso, allowed: [] });
  }
  // 31/12/2026: day first (the app's default zone is India); when both parts could
  // be a month, the month-first reading is accepted too.
  for (const m of text.matchAll(
    /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g,
  )) {
    const y = year(m[3])!;
    const dayFirst = realDay(y, Number(m[2]), Number(m[1]));
    const monthFirst = realDay(y, Number(m[1]), Number(m[2]));
    const primary = dayFirst ?? monthFirst;
    if (primary)
      out.push({ primary, allowed: [monthFirst].filter((d): d is string => !!d) });
  }
  const push = (d: number, mon: string, rawYear: string | undefined) => {
    const month =
      MONTHS[mon.toLowerCase().slice(0, mon.toLowerCase().startsWith("sept") ? 4 : 3)]!;
    const y = year(rawYear);
    const mention =
      y === null
        ? yearless(today, month, d)
        : (() => {
            const iso = realDay(y, month, d);
            return iso ? { primary: iso, allowed: [] } : null;
          })();
    if (mention) out.push(mention);
  };
  for (const m of text.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}\\b\\.?(?:,?\\s+(\\d{4}))?`,
      "gi",
    ),
  )) {
    push(Number(m[1]), m[2], m[3]);
  }
  for (const m of text.matchAll(
    new RegExp(
      `\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
      "gi",
    ),
  )) {
    push(Number(m[2]), m[1], m[3]);
  }
  return out;
}

/** Does the sentence date the request? "concrete": it names a day or a date; "vague": only
 *  loose timing ("next week", "soon", "end of the month", a deadline word); "none". */
export function timingWording(
  text: string,
  today: string,
): "concrete" | "vague" | "none" {
  if (
    relativeMentions(text, today).length +
      weekdayMentions(text, today).length +
      dateMentions(text, today).length >
    0
  ) {
    return "concrete";
  }
  return VAGUE_TIMING.test(text) ? "vague" : "none";
}

const VAGUE_TIMING =
  /\b(?:soon|asap|urgent(?:ly)?|eod|eow|eom|cob|end of (?:the |this |next )?(?:day|week|month|quarter|year)|(?:this|next|following|coming) (?:week|month|quarter|year)|(?:in|within) (?:a |an |\d+ |few |couple of )?(?:day|days|week|weeks|month|months|hour|hours)|deadline|due)\b/i;

export interface DueCheck {
  dueAt: string;
  /** Plain-language note for `ai.adjustments`. */
  note: string;
  /** false when the date could not be decided and is only flagged. */
  changed: boolean;
}

/**
 * Compare the model's date with the dates the quoted sentence names. Returns null
 * when there is nothing to say: no recognised wording, or the model's date is one
 * of the fair readings. One recognised date that disagrees replaces the model's;
 * several that disagree only produce a "please check" note.
 */
export function checkDueAgainstQuote(
  quote: string,
  dueAt: string | null,
  today: string,
): DueCheck | null {
  if (!dueAt || !quote.trim()) return null;
  const mentions = [
    ...relativeMentions(quote, today),
    ...weekdayMentions(quote, today),
    ...dateMentions(quote, today),
  ];
  if (mentions.length === 0) return null;
  if (mentions.some((m) => m.primary === dueAt || m.allowed.includes(dueAt))) return null;
  const primaries = [...new Set(mentions.map((m) => m.primary))];
  if (primaries.length === 1) {
    return {
      dueAt: primaries[0],
      changed: true,
      note: `The due date was changed from ${dayWords(dueAt)} to ${dayWords(primaries[0])} to match the message's own wording.`,
    };
  }
  return {
    dueAt,
    changed: false,
    note: `The due date ${dayWords(dueAt)} does not match the days named in the message: please check it.`,
  };
}
