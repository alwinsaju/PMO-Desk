// What "repeats" means for a to-do: the next due date after one is marked done.
// Pure calendar arithmetic on YYYY-MM-DD days (so a clock change cannot move a
// day); only "today" depends on the time zone. The text is free-form (the model
// or the person wrote it), so anything not clearly understood gives null and
// the app offers nothing rather than a guess.
import { CHECKPOINT_TEMPLATES } from "./checkpointTemplates.ts";
import { isRealIsoDay, istDate, safeTimeZone } from "./time.ts";
import type { CheckpointTemplateId, Todo, TodoDraft } from "./types.ts";

export type Recurrence =
  | { kind: "days"; n: number }
  | { kind: "weekdays" }
  | { kind: "weekdays-of"; days: number[] }
  | { kind: "months"; n: number };

const MAX_STEP = 100;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const WEEKDAY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// Monday, Mon, Mondays, Tues, Thurs ...
const WEEKDAY_WORD = /^(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?s?$/;

const UNIT_STEP: Record<string, { kind: "days" | "months"; size: number }> = {
  day: { kind: "days", size: 1 },
  week: { kind: "days", size: 7 },
  month: { kind: "months", size: 1 },
  quarter: { kind: "months", size: 3 },
  year: { kind: "months", size: 12 },
};

const ADVERB: Record<string, Recurrence> = {
  daily: { kind: "days", n: 1 },
  weekly: { kind: "days", n: 7 },
  fortnightly: { kind: "days", n: 14 },
  monthly: { kind: "months", n: 1 },
  quarterly: { kind: "months", n: 3 },
  yearly: { kind: "months", n: 12 },
  annually: { kind: "months", n: 12 },
  weekdays: { kind: "weekdays" },
};

const stepOf = (unit: string, count: number): Recurrence | null => {
  const base = UNIT_STEP[unit];
  if (!base || !Number.isInteger(count) || count < 1 || count > MAX_STEP) return null;
  return { kind: base.kind, n: base.size * count };
};

/** Read a recurrence phrase ("weekly, before Tuesday", "every 2 weeks", "every
 *  Mon and Thu", "monthly"); null when it is not one of the plain forms. */
export function parseRecurrence(text: string | null | undefined): Recurrence | null {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return null;

  const adverb = /^([a-z]+)\b(?!\s*-)/.exec(t);
  if (adverb && ADVERB[adverb[1]]) return ADVERB[adverb[1]];

  if (/^(?:every|each) (?:weekday|business day|working day)\b/.test(t)) {
    return { kind: "weekdays" };
  }

  const counted =
    /^(?:every|each) (?:(other)|(\d+|[a-z]+)) (day|week|month|quarter|year)s?\b/.exec(t);
  if (counted) {
    const count = counted[1]
      ? 2
      : /^\d+$/.test(counted[2])
        ? Number(counted[2])
        : NUMBER_WORDS[counted[2]];
    return count ? stepOf(counted[3], count) : null;
  }
  const single = /^(?:every|each) (day|week|month|quarter|year)\b/.exec(t);
  if (single) return stepOf(single[1], 1);

  const named = /^(?:every|each) ([a-z]+(?:(?:,| and | & |\/| or |, and )[a-z]+)*)/.exec(
    t,
  );
  if (named) {
    const parts = named[1]
      .split(/,| and | & |\/| or /)
      .map((p) => p.trim())
      .filter(Boolean);
    const days = parts.map((p) => WEEKDAY_WORD.exec(p)?.[1]);
    if (days.length > 0 && days.every(Boolean)) {
      const indexes = days.map((d) => WEEKDAY_INDEX.indexOf(d!));
      return { kind: "weekdays-of", days: [...new Set(indexes)].sort((a, b) => a - b) };
    }
  }
  return null;
}

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * 86_400_000);
const weekdayOf = (day: string) => new Date(toUtc(day)).getUTCDay();

/** `day` plus `months`, the day of month clamped to the month's end. */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(d, last)));
}

function nextDay(rule: Recurrence, base: string, floor: string): string {
  switch (rule.kind) {
    case "days": {
      const gone = Math.round((toUtc(floor) - toUtc(base)) / 86_400_000);
      return addDays(base, (Math.floor(gone / rule.n) + 1) * rule.n);
    }
    case "weekdays": {
      let day = addDays(floor, 1);
      while ([0, 6].includes(weekdayOf(day))) day = addDays(day, 1);
      return day;
    }
    case "weekdays-of": {
      let day = addDays(floor, 1);
      while (!rule.days.includes(weekdayOf(day))) day = addDays(day, 1);
      return day;
    }
    case "months": {
      let k = 1;
      while (addMonths(base, k * rule.n) <= floor) k++;
      return addMonths(base, k * rule.n);
    }
  }
}

/**
 * When a repeating to-do comes round next, once it is marked done at `doneAt`.
 * Steps from the to-do's own due date (so the rhythm holds), and always lands
 * after today in `timeZone`, so a to-do finished late does not get a due date
 * in the past. With no due date it counts from today. null when the recurrence
 * text is not understood.
 */
export function nextOccurrence(
  todo: Pick<Todo, "recurrence" | "dueAt" | "title">,
  doneAt: Date | string | number,
  timeZone?: string,
): { dueAt: string; title: string } | null {
  const rule = parseRecurrence(todo.recurrence);
  if (!rule) return null;
  const at = new Date(doneAt);
  if (Number.isNaN(at.getTime())) return null;
  const today = istDate(at, safeTimeZone(timeZone));
  const base = todo.dueAt && isRealIsoDay(todo.dueAt) ? todo.dueAt : today;
  const floor = base > today ? base : today;
  return { dueAt: nextDay(rule, base, floor), title: todo.title };
}

const templateOf = (todo: Pick<Todo, "checkpoints">): CheckpointTemplateId => {
  const labels = todo.checkpoints.map((c) => c.label).join("\n");
  const match = Object.values(CHECKPOINT_TEMPLATES).find(
    (template) => template.steps.map((s) => s.label).join("\n") === labels,
  );
  return match?.id ?? "simple";
};

/** The draft of the next round of a repeating to-do: same people, tags and
 *  priority, fresh steps, nothing waiting, action items back to open with no
 *  old dates. What the person approves with "Create next one". */
export function nextTodoDraft(
  todo: Pick<
    Todo,
    | "title"
    | "description"
    | "owner"
    | "requester"
    | "priority"
    | "tags"
    | "recurrence"
    | "actionItems"
    | "checkpoints"
  >,
  dueAt: string,
): TodoDraft {
  return {
    title: todo.title,
    description: todo.description,
    owner: { ...todo.owner },
    requester: { ...todo.requester },
    dueAt,
    priority: todo.priority,
    actionItems: todo.actionItems.map((item) => ({
      text: item.text,
      owner: item.owner ?? null,
      dueAt: null,
    })),
    checkpointTemplate: templateOf(todo),
    waitingOn: null,
    tags: [...todo.tags],
    recurrence: todo.recurrence,
  };
}
