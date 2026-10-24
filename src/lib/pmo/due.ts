// The reminder engine: which to-dos need a notification right now. Pure (no
// clock, no files, no node imports), so the server, the UI and `pnpm test` all
// use the same rules, and every test runs against a fake `now`.
//
// What the rules mean (the full write-up is ARCHITECTURE.md, "Reminders"):
//  - Everything is judged in `prefs.timeZone` (IST by default; IST has no DST,
//    but the maths is generic).
//  - due-soon   once per due date, while the due date is less than 24 h away.
//               A due date is the START of that day, so the heads-up lands on
//               the previous day and the overdue reminder takes over at 09:00
//               on the due day itself.
//  - overdue    09:00 (work start) on the due day, then once per working day.
//  - chaser     a to-do with "waiting on" set, untouched for N working days;
//               repeats every N working days after that.
//  - digest     optional, one summary of the open items per working day.
//  - quiet hours: with `quietOutsideHours` nothing is produced outside the
//               working window; the same notification simply becomes due when
//               the window opens (it has not been delivered yet, so it fires).
//  - snooze: `reminders.snoozedUntil` silences one to-do until that instant.
// Dedupe is by `key`: the server records delivered keys in state/notify.json.
import type { ReminderPrefs, Todo } from "./types.ts";

export type DueKind = "due-soon" | "overdue" | "chaser" | "digest";

export interface DueNotification {
  /** null for the digest. */
  todoId: string | null;
  kind: DueKind;
  /** Stable dedupe key: the same reminder always has the same key. */
  key: string;
  title: string;
  body: string;
  /** Digest only: how many open items it summarises. */
  count?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Time zone helpers (Intl only)
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalParts {
  /** YYYY-MM-DD in the zone. */
  day: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
  /** The wall-clock reading as if it were UTC, in ms (for offset maths). */
  wallMs: number;
}

export function localParts(
  instant: Date | string | number,
  timeZone: string,
): LocalParts {
  const date = new Date(instant);
  const bag: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date))
    bag[part.type] = part.value;
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  return {
    day: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAY_INDEX[bag.weekday] ?? 0,
    wallMs: Date.UTC(
      Number(bag.year),
      Number(bag.month) - 1,
      Number(bag.day),
      hour,
      minute,
      Number(bag.second),
    ),
  };
}

/** The UTC instant at which the clock in `timeZone` reads `day` `hhmm`. */
export function zonedInstant(day: string, hhmm: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const offsetAt = (ts: number) => localParts(ts, timeZone).wallMs - (ts - (ts % 1000));
  // Two passes settle the offset even when it changes (DST) near `wall`.
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess);
}

/** YYYY-MM-DD moved by `offset` calendar days (month/year rollover exact). */
export function addDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

const weekdayOf = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
};

/** The first Monday after `day` (a Monday gives the one a week later). */
export const nextMondayAfter = (day: string): string =>
  addDays(day, (8 - weekdayOf(day)) % 7 || 7);

export const isWorkingDay = (day: string, prefs: Pick<ReminderPrefs, "workDays">) =>
  prefs.workDays.includes(weekdayOf(day));

/** Working days in the half-open range (from, to]: 0 when `to` is not later. */
export function workingDaysBetween(
  from: string,
  to: string,
  prefs: Pick<ReminderPrefs, "workDays">,
): number {
  let count = 0;
  let day = from;
  for (let guard = 0; day < to && guard < 800; guard++) {
    day = addDays(day, 1);
    if (isWorkingDay(day, prefs)) count++;
  }
  return count;
}

const clockMinutes = (hhmm: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
};

const calendarDaysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T00:00:00Z`));

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

export const isSnoozed = (todo: Pick<Todo, "reminders">, now: Date): boolean => {
  const until = todo.reminders.snoozedUntil;
  return until !== null && Date.parse(until) > now.getTime();
};

export type SnoozeChoice = "1h" | "tomorrow" | "monday";

/** When a quick-snooze button wakes the to-do up. "Tomorrow" and "Monday" are
 *  at the start of the working day (09:00 by default) in the prefs' zone;
 *  "Monday" is the next Monday after today (a Monday snoozes a full week). */
export function snoozeUntil(
  choice: SnoozeChoice,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workStart">,
): Date {
  if (choice === "1h") return new Date(now.getTime() + HOUR_MS);
  const today = localParts(now, prefs.timeZone).day;
  const day = choice === "tomorrow" ? addDays(today, 1) : nextMondayAfter(today);
  return zonedInstant(day, prefs.workStart, prefs.timeZone);
}

/** A `datetime-local` value ("2026-10-26T09:30") read in the prefs' zone. */
export function instantFromLocalInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match) return null;
  const instant = zonedInstant(match[1], match[2], timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** "Mon 26 Oct, 09:00" for an instant in the zone. */
export function describeInstant(instant: Date | string, timeZone: string): string {
  const date = new Date(instant);
  const parts = localParts(date, timeZone);
  const hh = String(Math.floor(parts.minutes / 60)).padStart(2, "0");
  const mm = String(parts.minutes % 60).padStart(2, "0");
  return `${shortDay(parts.day)}, ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const KIND_RANK: Record<DueKind, number> = {
  overdue: 0,
  chaser: 1,
  "due-soon": 2,
  digest: 3,
};

/** Everything that should be notified at `now`, minus nothing: dedupe against
 *  what was already delivered is the caller's job (it owns the state). */
export function computeDue(
  todos: readonly Todo[],
  now: Date,
  prefs: ReminderPrefs,
): DueNotification[] {
  if (!prefs.enabled) return [];

  const zone = prefs.timeZone;
  const local = localParts(now, zone);
  const today = local.day;
  const start = clockMinutes(prefs.workStart);
  const end = clockMinutes(prefs.workEnd);
  const workingToday = isWorkingDay(today, prefs);
  const afterStart = local.minutes >= start;
  const inWindow = workingToday && afterStart && local.minutes < end;
  // The day-bound kinds (overdue, chaser, digest) never fire before the day's
  // start, or on a day off; quiet hours also stop them at the end of the day.
  const dayKindsOpen = prefs.quietOutsideHours ? inWindow : workingToday && afterStart;
  const dueSoonOpen = prefs.quietOutsideHours ? inWindow : true;

  const open = todos.filter((todo) => todo.status === "open");
  const out: DueNotification[] = [];

  for (const todo of open) {
    if (isSnoozed(todo, now)) continue;

    if (todo.dueAt) {
      const dueInstant = zonedInstant(todo.dueAt, "00:00", zone).getTime();
      const ahead = dueInstant - now.getTime();
      if (dueSoonOpen && ahead > 0 && ahead < DAY_MS) {
        out.push({
          todoId: todo.id,
          kind: "due-soon",
          key: `due-soon:${todo.id}:${todo.dueAt}`,
          title: todo.title,
          body: `Due tomorrow (${shortDay(todo.dueAt)}).`,
        });
      } else if (dayKindsOpen && todo.dueAt <= today) {
        const late = calendarDaysBetween(todo.dueAt, today);
        out.push({
          todoId: todo.id,
          kind: "overdue",
          key: `overdue:${todo.id}:${todo.dueAt}:${today}`,
          title: todo.title,
          body:
            late === 0
              ? "Due today."
              : `Overdue by ${plural(late, "day")} (was due ${shortDay(todo.dueAt)}).`,
        });
      }
    }

    const waitingOn = todo.waitingOn?.trim();
    if (dayKindsOpen && waitingOn && !Number.isNaN(Date.parse(todo.updatedAt))) {
      const lastTouched = localParts(todo.updatedAt, zone).day;
      const quiet = workingDaysBetween(lastTouched, today, prefs);
      if (quiet >= prefs.chaserDays) {
        const round = Math.floor(quiet / prefs.chaserDays);
        out.push({
          todoId: todo.id,
          kind: "chaser",
          key: `chaser:${todo.id}:${lastTouched}:${round}`,
          title: todo.title,
          body: `Waiting on ${waitingOn} with no update for ${plural(quiet, "working day")}. Time to chase?`,
        });
      }
    }
  }

  if (prefs.digest && dayKindsOpen && open.length > 0) {
    const titles = open.slice(0, 5).map((todo) => `- ${todo.title}`);
    const more =
      open.length > titles.length ? [`+${open.length - titles.length} more`] : [];
    out.push({
      todoId: null,
      kind: "digest",
      key: `digest:${today}`,
      title: `PMO To-Do: ${plural(open.length, "open item")}`,
      body: [...titles, ...more].join("\n"),
      count: open.length,
    });
  }

  const dueDay = new Map(open.map((todo) => [todo.id, todo.dueAt ?? "9999-99-99"]));
  return out.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      (dueDay.get(a.todoId ?? "") ?? "").localeCompare(
        dueDay.get(b.todoId ?? "") ?? "",
      ) ||
      a.key.localeCompare(b.key),
  );
}

// ---------------------------------------------------------------------------
// What the notification says (privacy default) and the badge count
// ---------------------------------------------------------------------------

export interface Toast {
  title: string;
  body: string;
  /** Set only when the toast is about exactly one to-do: clicking opens it. */
  todoId: string | null;
}

/** One toast for a batch of notifications. With `hideDetails` (the default)
 *  the text is only "PMO To-Do: N items need attention": no title, no name. */
export function toastFor(
  batch: readonly DueNotification[],
  prefs: Pick<ReminderPrefs, "hideDetails">,
): Toast | null {
  if (batch.length === 0) return null;
  const ids = [...new Set(batch.flatMap((n) => (n.todoId ? [n.todoId] : [])))];
  const digestOnly = ids.length === 0;
  const count = digestOnly ? 0 : ids.length;
  const todoId = ids.length === 1 ? ids[0] : null;

  const headlineFor = (n: number) =>
    `PMO To-Do: ${n} ${n === 1 ? "item needs" : "items need"} attention`;
  if (digestOnly) {
    const digest = batch[0];
    return prefs.hideDetails
      ? { title: headlineFor(digest.count ?? 0), body: "", todoId: null }
      : { title: digest.title, body: digest.body, todoId: null };
  }
  const headline = headlineFor(count);
  if (prefs.hideDetails) return { title: headline, body: "", todoId };
  if (batch.length === 1) return { title: batch[0].title, body: batch[0].body, todoId };
  const lines = batch.slice(0, 4).map((n) => `- ${n.title}`);
  const more =
    batch.length > lines.length ? [`+${batch.length - lines.length} more`] : [];
  return { title: headline, body: [...lines, ...more].join("\n"), todoId };
}

export interface Attention {
  /** Distinct open, un-snoozed to-dos that need a look right now. */
  count: number;
  /** Due before today. */
  overdue: number;
  /** Due today or tomorrow. */
  dueSoon: number;
  /** Waiting on someone for at least `chaserDays` working days. */
  waiting: number;
}

export const isDueSoon = (todo: Pick<Todo, "dueAt" | "status">, today: string): boolean =>
  todo.status === "open" &&
  todo.dueAt !== null &&
  todo.dueAt >= today &&
  todo.dueAt <= addDays(today, 1);

export const isWaiting = (todo: Pick<Todo, "waitingOn" | "status">): boolean =>
  todo.status === "open" && !!todo.waitingOn?.trim();

/** The number on the dock badge. State based (what needs a look now), unlike
 *  `computeDue` (what to announce now), so it does not depend on quiet hours. */
export function attentionSummary(
  todos: readonly Todo[],
  now: Date,
  prefs: ReminderPrefs,
): Attention {
  const today = localParts(now, prefs.timeZone).day;
  const ids = new Set<string>();
  let overdue = 0;
  let dueSoon = 0;
  let waiting = 0;
  for (const todo of todos) {
    if (todo.status !== "open" || isSnoozed(todo, now)) continue;
    if (todo.dueAt && todo.dueAt < today) {
      overdue++;
      ids.add(todo.id);
    } else if (isDueSoon(todo, today)) {
      dueSoon++;
      ids.add(todo.id);
    }
    if (
      isWaiting(todo) &&
      !Number.isNaN(Date.parse(todo.updatedAt)) &&
      workingDaysBetween(localParts(todo.updatedAt, prefs.timeZone).day, today, prefs) >=
        prefs.chaserDays
    ) {
      waiting++;
      ids.add(todo.id);
    }
  }
  return { count: ids.size, overdue, dueSoon, waiting };
}
